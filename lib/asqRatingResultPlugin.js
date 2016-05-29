var ASQPlugin = require('asq-plugin');
var ObjectId = require('mongoose').Types.ObjectId;
var Promise = require('bluebird');
var coroutine = Promise.coroutine;
var cheerio = require('cheerio');
var mongoose = require('mongoose');
var ObjectId = mongoose.Types.ObjectId;
var assert = require('assert');
var _ = require('lodash');


//http://www.w3.org/html/wg/drafts/html/master/infrastructure.html#boolean-attributes
function getBooleanValOfBooleanAttr(attrName, attrValue){
  if(attrValue === '' || attrValue === attrName){
    return true;
  }
  return false;
}

module.exports = ASQPlugin.extend({
  tagName : 'asq-rating-result',
  targetTagName: 'asq-rating-q',

  hooks:{
    "parse_html" : "parseHtml",
    "after_answer_submission" : "afterAnswerSubmission",
    "presenter_connected" : "presenterConnected",
    "viewer_connected" : "viewerConnected"
  },

  parseHtml: coroutine(function *parseHtml(options){
    var html = options.html
    var $ = cheerio.load(html, {decodeEntities: false});

    var ratingResults = yield Promise.map($(this.tagName).get(), function( el){
      return this.processEl($, el);
    }.bind(this));

    options.html = $.root().html()

    return Promise.resolve(options);    
  }),

  afterAnswerSubmission: coroutine(function *answerSubmissionGen (info){
    // make sure answer question exists
    var answer = info.answer;
    var questionUid = answer.questionUid
    var question = yield this.asq.db.model("Question").findById(questionUid).exec(); 
    assert(question,
      'Could not find question with id' + questionUid + 'in the database');

    //make sure it's an answer for an asq-rating question
    if(question.type !== this.targetTagName) {
      return answer;
    }

    this.calculateProgress(answer.session, ObjectId(questionUid));

    //this will be the argument to the next hook
    return info;
  }),

  calculateProgress: coroutine(function *calculateProgressGen(session_id, question_id){
    var criteria = {session: session_id, question:question_id};
    var pipeline = [
      { $match: {
          session: session_id,
          question : question_id
        }
      },
      {$sort:{"submitDate":-1}},
      { $group:{
          "_id":"$answeree",
          "submitDate":{$first:"$submitDate"},
          "submission": {$first:"$submission"},
        }
      },
      { $unwind: "$submission" },
      { $group:{
          "_id":"$submission._id",
          "rating":{$avg: "$submission.rating"}
        }
      }
    ]
    var ratings = yield this.asq.db.model('Answer').aggregate(pipeline).exec();
  
    var ratingsMap = {};
    ratings.forEach(function(rating){
      ratingsMap[rating._id] = rating.rating;
    });


    var event = {
      questionType: this.tagName,
      type: 'progress',
      question: {
        uid: question_id.toString(),
        ratings: ratingsMap
      }
    }

    this.asq.socket.emitToRoles('asq:question_type', event, session_id.toString(), 'ctrl', 'folo')
  }),

  copyRatings : function(aggrRating, question){
    for(var i = 0, l = aggrRating.ratingItems.length; i<l; i++){
      for(var j = 0, l2 = question.data.ratingItems.length; j<l2; j++){
        if(aggrRating.ratingItems[i]._id.toString()  == question.data.ratingItems[j]._id){
          question.data.ratingItems[j].rating = aggrRating.ratingItems[i].rating;
          break;
        }
      }
    }
  },
  
  restorePresenterForSession: coroutine(function *restorePresenterForSessionGen(session_id, presentation_id){
    
    var questions = yield this.asq.db.getPresentationQuestionsByType(presentation_id, this.targetTagName);
    var questionIds = questions.map(function(q){
      return q._id;
    });

    var pipeline = [
      { $match: {
          session: session_id,
          "question" : {$in : questionIds}
        }
      },
      { $sort:{"submitDate": -1}},
      { $group:{
          "_id":{
            "answeree" : "$answeree",
            "question" : "$question"
          },
          "submitDate":{$first:"$submitDate"},
          "submission": {$first:"$submission"},
        }
      },
      { $unwind: "$submission" },
      { $group:{
          "_id":{
            "question" : "$_id.question",
            "rating_id": "$submission._id"
          },
          "rating":{$avg: "$submission.rating"},
          "submitDate":{$first: "$submitDate"},
          "submission": {$first: "$submission"},
        }
      },
      { $group:{
          "_id": {
            "question" : "$_id.question",
          },
          "ratingItems":{$push: {"_id" : "$_id.rating_id" , "rating": "$rating"}}
        }
      },
      { $project : { 
          "_id": 0,
          "question" : "$_id.question",
          "ratingItems" : 1
        } 
      }
    ]
    var ratings = yield this.asq.db.model('Answer').aggregate(pipeline).exec();

    var questionIds = ratings.map(function(rating, index){
      return rating.question;
    });

    var questions = yield this.asq.db.model('Question')
      .find({_id : {$in: questionIds}}).lean().exec();

    questions.forEach(function(q){
      q.uid = q._id.toString();
      for(var i=0, l=ratings.length; i<l; i++){
        if(ratings[i].question.toString() == q._id){
          this.copyRatings(ratings[i], q);
          break;
        }
      }
    }.bind(this));

    return questions;    
  }),

  presenterConnected: coroutine(function *presenterConnectedGen (info){

    if(! info.session_id) return info;

    var questionsWithScores = yield this.restorePresenterForSession(info.session_id, info.presentation_id);

    var event = {
      questionType: this.tagName,
      type: 'restorePresenter',
      questions: questionsWithScores
    }

    this.asq.socket.emit('asq:question_type', event, info.socketId)

    //this will be the argument to the next hook
    return info;
  }),

  restoreViewerForSession: coroutine(function *restoreViewerForSessionGen(session_id, presentation_id){
    return this.restorePresenterForSession(session_id, presentation_id);    
  }),

  viewerConnected: coroutine(function *viewerConnectedGen (info){

    if(! info.session_id) return info;

    var questionsWithAnswers = yield this.restoreViewerForSession(info.session_id, info.presentation_id);

    var event = {
      questionType: this.tagName,
      type: 'restoreViewer',
      questions: questionsWithAnswers
    }

    this.asq.socket.emit('asq:question_type', event, info.socketId)

    // this will be the argument to the next hook
    return info;
  }),

  processEl: coroutine(function *processElGen($, el){

    var $el = $(el);

    //make sure question has a unique id
    var uid = $el.attr('uid');
    if(uid == undefined || uid.trim() == ''){
      $el.attr('uid', uid = ObjectId().toString() );
    } 

    //find target
    var targetid = $el.attr('targetid');
    assert(!_.isEmpty(targetid)
      , 'An asq-rating-result element should have a varlid targetid attribute' )

    var $targetEl = $('#' + targetid);
    assert($targetEl.length >0
      , 'An asq-rating-result element should have a target element that exists' );

    var targetTagName =  $targetEl[0].tagName || $targetEl[0].name;
    assert(targetTagName.toLowerCase() == "asq-rating-q"
      , 'An asq-rating-result element should have a target that is an asq-rating element' );

    var targetUid = $targetEl.attr('uid')
    assert(!_.isEmpty(targetUid)
      , 'An asq-rating-result element should have a target element that has a uid' );

    var targetQuestion = yield this.asq.db.model('Question').findById(targetUid).lean().exec();
    assert(!_.isEmpty(targetQuestion)
      , 'An asq-rating-result element should have a target element that exists in the db' );

    $el.append('<asq-stem>' + targetQuestion.data.stem + '</asq-stem>');
    if(targetQuestion.data.ratingItems){
      targetQuestion.data.ratingItems.forEach(function(rItem){
        var newHtml = '<asq-rating-item type="' + rItem.type+ '" ';
        newHtml += 'data-targetuid="' + rItem._id.toString() + '" disabled>';
        newHtml += rItem.html +'</asq-rating-item>';
        $el.append(newHtml)
      })
    }

    $el.attr('targetuid', targetUid );

    return {
      _id : uid,
      type: this.tagName,
      data: {
        target: targetUid
      }
    }
  })
});