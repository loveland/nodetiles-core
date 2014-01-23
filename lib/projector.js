// TODO this should support passing in projection strings in many formats, including preconstructed Proj4 objects

var Proj4js = require('proj4js');
require('proj4js-defs')(Proj4js);
var __ = require('lodash');

var A = 6378137,
    MAXEXTENT = 20037508.34,
    ORIGIN_SHIFT = Math.PI * 6378137,
    D2R = Math.PI / 180,
    R2D = 180 / Math.PI; //20037508.342789244

// Cache for for storing and reusing Proj4 instances
var projectorCache = {};

// Ensure that you have a Proj4 object, pulling from the cache if necessary
var getProj4 = function(projection) {
  if (projection instanceof Proj4js.Proj) {
    return projection;
  }
  else if (projection in projectorCache) {
    return projectorCache[projection];
  }
  else {
    return projectorCache[projection] = new Proj4js.Proj(projection);
  }
};

//projection defs: we should add more here

// Credit for the math: http://www.maptiler.org/google-maps-coordinates-tile-bounds-projection/
// TODO: just use https://github.com/mapbox/node-sphericalmercator/blob/master/sphericalmercator.js
var util = {
  cleanProjString: function(text) {
    if (typeof text === "number") {
      return "EPSG:"+text;
    } else if (text.indexOf("EPSG:") > -1){
      return text;
    } else if (text.indexOf("+proj") > -1) {
      // proj4 string
      Proj4js.defs["NODETILES:9999"] = text;
      return "NODETILES:9999";
    } else {
      console.warn("Invalid projection string");
      return "EPSG:4326"
    }
  },
  pixelsToMeters: function(x, y, zoom, tileSize) {
    var mx, my;
    var tileSize = tileSize || 256;
    // meters per pixel at zoom 0
    var initialResolution = 2 * Math.PI * 6378137 / tileSize;
    //Resolution (meters/pixel) for given zoom level (measured at Equator)"
    var res = initialResolution / Math.pow(2,zoom);
    // return (2 * math.pi * 6378137) / (self.tileSize * 2**zoom)
    mx = x * res - ORIGIN_SHIFT;
    my = y * res - ORIGIN_SHIFT;
    return [mx, my];
  },

  // Thanks to https://github.com/mapbox/node-sphericalmercator/blob/master/sphericalmercator.js
  metersToLatLon: function(c) {
    return [
        (c[0] * R2D / A),
        ((Math.PI*0.5) - 2.0 * Math.atan(Math.exp(-c[1] / A))) * R2D
    ];
  },
  latLonToMeters: function(c) {
    var xy = [
        A * c[0] * D2R,
        A * Math.log(Math.tan((Math.PI*0.25) + (0.5 * c[1] * D2R)))
    ];
    // if xy value is beyond maxextent (e.g. poles), return maxextent.
    (xy[0] > MAXEXTENT) && (xy[0] = MAXEXTENT);
    (xy[0] < -MAXEXTENT) && (xy[0] = -MAXEXTENT);
    (xy[1] > MAXEXTENT) && (xy[1] = MAXEXTENT);
    (xy[1] < -MAXEXTENT) && (xy[1] = -MAXEXTENT);
    return xy;
  },
  tileToMeters: function(x, y, zoom, tileSize){
    var tileSize = tileSize || 256;
    y = (Math.pow(2,zoom) - 1) - y; // TMS to Google tile scheme
    var min = util.pixelsToMeters(x*tileSize, y*tileSize, zoom);
    var max = util.pixelsToMeters((x+1)*tileSize, (y+1)*tileSize, zoom);
    return [min[0], min[1], max[0], max[1]];
  }
}

var inP;
var outP;

var project = {

  'FeatureCollection': function(inProjection, outProjection, fc) {
    var from = getProj4(inProjection);
    var to = getProj4(outProjection);

    // NOTE:
    // We no longer clone the featureCollection object.
    // This increases performance (no longer cloning thousands of objects!)
    // However, it does mean we lose the original projection
    // In 99 % of cases, that should be fine.
    var _fc = fc;

    for (var i = _fc.features.length - 1; i >= 0; i--) {
      _fc.features[i] = project.Feature(from, to, _fc.features[i]);
    }

    return _fc;
  },

  'Feature': function(inProjection, outProjection, f) {
    var _f = f;
    _f.geometry = f.geometry;
    _f.geometry.coordinates = project[f.geometry.type](inProjection, outProjection, _f.geometry.coordinates);
    return _f;
  },

  'MultiPolygon': function(inProjection, outProjection, mp) {
    return mp.map(project.Polygon.bind(null, inProjection, outProjection));
  },

  'Polygon': function(inProjection, outProjection, p) {
    for (var i = p.length - 1; i >= 0; i--) {
      p[i] = project.LineString(inProjection, outProjection, p[i]);
    }
    return p;
  },

  'MultiLineString': function(inProjection, outProjection, ml) {
    return ml.map(project.LineString.bind(null, inProjection, outProjection));
  },

  'LineString': function(inProjection, outProjection, l) {
    for (var i = l.length - 1; i >= 0; i--) {
      l[i] = project.Point(inProjection, outProjection, l[i]);
    };
    return l;
  },

  'MultiPoint': function(inProjection, outProjection, mp) {
    return mp.map(project.Point.bind(null, inProjection, outProjection));
  },

  'Point': function(inProjection, outProjection, c) {
    if (inProjection && outProjection) {
      var inProjectionCode;
      var outProjectionCode;

      if(inProjection instanceof Proj4js.Proj) {
        inProjectionCode = 'EPSG:' + inProjection.srsProjNumber;
      } else {
        inProjectionCode = inProjection;
      }

      if(outProjection instanceof Proj4js.Proj) {
        outProjectionCode = 'EPSG:' + outProjection.srsProjNumber;
      }else {
        outProjectionCode = outProjection;
      }

      if (inProjectionCode == 'EPSG:4326' && outProjectionCode == 'EPSG:900913') {
        return util.latLonToMeters(c);
      }
      else if (inProjectionCode == 'EPSG:900913' && outProjectionCode == 'EPSG:4326') {
        return util.metersToLatLon(c);
      }

      var from = getProj4(inProjection);
      var to = getProj4(outProjection);
      var point = new Proj4js.Point(c);
      Proj4js.transform(from, to, point);
      return [point.x, point.y];
    }
    return c;
  }
};

// TODO: cleanup interface
module.exports.util = util;
module.exports.project = project;

