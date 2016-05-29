"use strict";

var chai = require('chai');
var sinon = require("sinon");
var should = chai.should();
var expect = chai.expect;
var cheerio = require('cheerio');
var Promise = require('bluebird');
var modulePath = "../../lib/asqRatingPlugin";
var fs = require("fs");

describe("asqRatingPlugin.js", function(){
  
  before(function(){
    var then =  this.then = function(cb){
      return cb();
    };

    var create = this.create = sinon.stub().returns({
      then: then
    });

    this.tagName = "asq-rating";

    this.asq = {
      registerHook: function(){},
      db: {
        model: function(){
          return {
            create: create
          }
        }
      }
    }

    //load html fixtures
    this.simpleHtml = fs.readFileSync(require.resolve('./fixtures/simple.html'), 'utf-8');
    this.noStemHtml = fs.readFileSync(require.resolve('./fixtures/no-stem.html'), 'utf-8');
    this.RatingItemsHtml = fs.readFileSync(require.resolve('./fixtures/rating-items.html'), 'utf-8');
    
    this.asqRatingPlugin = require(modulePath);
  });

  describe("parseHtml", function(){

    before(function(){
     sinon.stub(this.asqRatingPlugin.prototype, "processEl").returns("res");
    });

    beforeEach(function(){
      this.asqr = new this.asqRatingPlugin(this.asq);
      this.asqRatingPlugin.prototype.processEl.reset();
      this.create.reset();
    });

    after(function(){
     this.asqRatingPlugin.prototype.processEl.restore();
    });

    it("should call processEl() for all asq-rating elements", function(done){
      this.asqr.parseHtml(this.simpleHtml)
      .then(function(){
        this.asqr.processEl.calledTwice.should.equal(true);
        done();
      }.bind(this))
      .catch(function(err){
        done(err)
      })
    });

    it("should call `model().create()` to persist parsed questions in the db", function(done){
      this.asqr.parseHtml(this.simpleHtml)
      .then(function(result){
        this.create.calledOnce.should.equal(true);
        this.create.calledWith(["res", "res"]).should.equal(true);
        done();
      }.bind(this))
      .catch(function(err){
        done(err)
      })
    });

    it("should resolve with the file's html", function(done){
      this.asqr.parseHtml(this.simpleHtml)
      .then(function(result){
        expect(result).to.equal(this.simpleHtml);
        done();
      }.bind(this))
      .catch(function(err){
        done(err)
      })
    });

  });

  describe("processEl", function(){

    before(function(){
     sinon.stub(this.asqRatingPlugin.prototype, "parseRatingItems").returns([]);
    });

    beforeEach(function(){
      this.asqr = new this.asqRatingPlugin(this.asq);
      this.asqRatingPlugin.prototype.parseRatingItems.reset();
    });

    after(function(){
     this.asqRatingPlugin.prototype.parseRatingItems.restore();
    });

    it("should assign a uid to the question if there's not one", function(){
      var $ = cheerio.load(this.simpleHtml);
      
      //this doesn't have an id
      var el = $("#no-uid")[0];
      this.asqr.processEl($, el);
      $(el).attr('uid').should.exist;
      $(el).attr('uid').should.not.equal("a-uid");

      //this already has one
      el = $("#uid")[0];
      this.asqr.processEl($, el);
      $(el).attr('uid').should.exist;
      $(el).attr('uid').should.equal("a-uid");
    });

    it("should call parseRatingItems()", function(){
      var $ = cheerio.load(this.simpleHtml);
      var el = $(this.tagName)[0];

      this.asqr.processEl($, el);
      this.asqr.parseRatingItems.calledOnce.should.equal(true);
    });

    it("should find the stem if it exists", function(){
      var $ = cheerio.load(this.simpleHtml);
      var el = $(this.tagName)[0];
      var elWithHtmlInStem = $(this.tagName)[1];

      var result = this.asqr.processEl($, el);
      expect(result.data.stem).to.equal("This is a stem");

      var result = this.asqr.processEl($, elWithHtmlInStem);
      expect(result.data.stem).to.equal("This is a stem <em>with some HTML</em>");


      var $ = cheerio.load(this.noStemHtml);
      var el = $(this.tagName)[0];
      var result = this.asqr.processEl($, el);
      expect(result.data.stem).to.equal("");
    });

    it("should return correct data", function(){
      var $ = cheerio.load(this.simpleHtml);
      var el = $(this.tagName)[1];

      var result = this.asqr.processEl($, el);
      expect(result._id).to.equal("a-uid");
      expect(result.type).to.equal(this.tagName);
      expect(result.data.stem).to.equal("This is a stem <em>with some HTML</em>");
      expect(result.data.ratingItems).to.deep.equal([]);
    });
  });

  describe("parseRatingItems", function(){

    beforeEach(function(){
      this.$ = cheerio.load(this.RatingItemsHtml);
      this.asqr = new this.asqRatingPlugin(this.asq);
    });

    it("should throw an error when there less than one `asq-rating-item` tags", function(){
      var el = this.$("#no-ratings")[0];
      var bindedFn = this.asqr.parseRatingItems.bind(this.asqr, this.$, el);
      expect(bindedFn).to.throw(/at least one `asq-rating-item` child/);
    });

    it("should assign a uid to rating-items that don't have one", function(){
      var el;

      el = this.$("#no-uids")[0];
      this.asqr.parseRatingItems(this.$, el);
      this.$(el).find('asq-rating-item').eq(0).attr('uid').should.exist;
      this.$(el).find('asq-rating-item').eq(1).attr('uid').should.exist;
      this.$(el).find('asq-rating-item').eq(2).attr('uid').should.exist;

      el = this.$("#uids-ok")[0];
      this.asqr.parseRatingItems(this.$, el);
      this.$(el).find('asq-rating-item').eq(0).attr('uid').should.equal("0123456789abcd0123456781");
      this.$(el).find('asq-rating-item').eq(1).attr('uid').should.equal("0123456789abcd0123456782");
      this.$(el).find('asq-rating-item').eq(2).attr('uid').should.equal("0123456789abcd0123456783");
    });

    it("should throw an error when there are more than one asq-rating-item with the same uid", function(){
      var el = this.$("#same-uids")[0];
      var bindedFn = this.asqr.parseRatingItems.bind(this.asqr, this.$, el);
      expect(bindedFn).to.throw(/cannot have two `asq-rating-items` with the same uids/);
    });

    it("should parse the `type` attribute of options", function(){
      var el = this.$("#type")[0];
      var result = this.asqr.parseRatingItems(this.$, el);
      expect(result[0].type).to.equal("stars");
      expect(result[1].type).to.equal("stars");
      expect(result[2].type).to.equal("type-2");
    });

    it("should output the correct data", function(){
      var el = this.$("#type")[0];
      var result = this.asqr.parseRatingItems(this.$, el);
      expect(result[0]._id.toString()).to.equal("0123456789abcd0123456781");
      expect(result[0].html).to.equal("Item to rate #1");
      expect(result[0].type).to.equal("stars");
      expect(result[1]._id.toString()).to.equal("0123456789abcd0123456782");
      expect(result[1].html).to.equal("Item to rate <em>#2</em>");
      expect(result[1].type).to.equal("stars");
      expect(result[2]._id.toString()).to.equal("0123456789abcd0123456783");
      expect(result[2].html).to.equal("Item to rate #3");
      expect(result[2].type).to.equal("type-2");
    });
  });
});
