var expect = require("chai").expect;
var nodetiles = require(__dirname + "/../index");
var Map = nodetiles.Map;
var GeoJsonSource = nodetiles.datasources.GeoJson;

function streamToBuffer(stream, callback) {
  var chunks = [];
  stream.on("data", function(chunk) { chunks.push(chunk); });
  stream.on("end", function() { callback(null, Buffer.concat(chunks)); });
  stream.on("error", callback);
}

describe("cartoRenderer (end-to-end under node-canvas)", function() {
  this.timeout(5000);

  it("renders a styled polygon to a non-empty PNG", function(done) {
    var map = new Map({ projection: "EPSG:4326" });
    map.addData(new GeoJsonSource({
      name: "shapes",
      path: __dirname + "/fixtures/polygon.geojson",
      projection: "EPSG:4326"
    }));
    map.addStyle([
      "Map { background-color: #ffffff; }",
      "#shapes { polygon-fill: #ff0000; line-color: #000000; line-width: 2; }"
    ].join("\n"));

    map.render({
      bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
      width: 64,
      height: 64,
      zoom: 4,
      callback: function(error, canvas) {
        if (error) return done(error);
        expect(canvas).to.exist;
        expect(canvas.width).to.equal(64);
        expect(canvas.height).to.equal(64);

        streamToBuffer(canvas.createPNGStream(), function(err, buf) {
          if (err) return done(err);
          expect(buf.length).to.be.greaterThan(100);
          expect(buf.slice(0, 8).toString("hex"))
            .to.equal("89504e470d0a1a0a"); // PNG magic bytes

          var ctx = canvas.getContext("2d");
          var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          var redPixels = 0;
          for (var i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 200 && pixels[i + 1] < 50 && pixels[i + 2] < 50) {
              redPixels++;
            }
          }
          expect(redPixels).to.be.greaterThan(0);
          done();
        });
      }
    });
  });
});
