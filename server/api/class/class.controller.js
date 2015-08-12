'use strict';

var async = require('async');
var httpstatus = require('http-status');
var makeArray = require('make-array');

// local dependencies
var restutils = require('../../components/restutils');
var db = require('../../config/db/store');
var dberrors = require('../../config/db/errors');
var log = require('../../config/log');

var responses = restutils.res;
var requests = restutils.req;

module.exports.getClasses = function getClasses (req, res) {
  log.debug({
    params : req.params,
    query : req.query
  }, 'Getting classes');

  var tenantid = req.params.tenantid;
  var options = requests.listoptions(req);

  async.parallel([
    function getBatch (next) {
      db.getClasses(tenantid, options, next);
    },
    function getCount (next) {
      db.countClasses(tenantid, next);
    }
  ], function returnClasses (err, classresults) {
    if (err) {
      return responses.error(res, err);
    }
    var classes = classresults[0];
    var count = classresults[1];

    log.debug({
      tenant : tenantid,
      num : count
    }, 'Got classes');

    responses.batch(classes, options.skip, count, res);
  });
};

module.exports.getClass = function getClass (req, res) {
  log.debug({params : req.params}, 'Getting class');

  var tenantid = req.params.tenantid;
  var classid = req.params.classid;

  db.getClass(tenantid, classid, function returnClass (err, classification) {
    if (err) {
      return dberrors.handle(err, [httpstatus.NOT_FOUND], 'Error occurred while attempting to retrieve class.', function returnResponse () {
        return responses.error(res, err);
      });
    }
    responses.item(classification, res);
  });
};

module.exports.createClass = function createClass (req, res) {
  log.debug({
    body : req.body,
    params : req.params
  }, 'Creating class');

  var tenantid = req.params.tenantid;
  var classattrs = req.body;

  if (!classattrs || !Object.keys(classattrs).length) {
    return responses.badrequest('Missing request body', res);
  }

  db.createClass(tenantid, classattrs, function returnNewClass (err, classification) {
    if (err) {
      return dberrors.handle(err, [httpstatus.BAD_REQUEST], 'Error occurred while attempting to create class.', function returnResponse () {
        return responses.error(res, err);
      });
    }

    log.debug({
      class : classification
    }, 'Created class');

    responses.newitem(
      classification,
      req.baseUrl + req.route.path, {
        ':tenantid' : tenantid, ':classid' : classification._id
      },
      res);
  });
};

module.exports.replaceClass = function replaceClass (req, res) {
  log.debug({params : req.params}, 'Replacing class');

  var tenantid = req.params.tenantid;
  var classid = req.params.classid;
  var etag = req.headers['if-match'];
  var classattrs = req.body;

  if (!classattrs || !Object.keys(classattrs).length) {
    return responses.badrequest('Missing request body', res);
  }

  if (!etag) {
    return responses.missingEtag(res);
  }

  if (classattrs.id && classattrs.id !== classid) {
    return responses.badrequest('Mismatch of class id', res);
  }

  classattrs.id = classid;

  db.replaceClass(tenantid, classattrs, etag, function replacedClass (err, replaced) {
    if (err) {
      return dberrors.handle(err, [httpstatus.BAD_REQUEST], 'Error occurred while attempting to replace class.', function returnResponse () {
        return responses.error(res, err);
      });
    }
    log.debug({class : classid}, 'Replaced class');
    responses.edited(res, replaced);
  });
};

module.exports.deleteClass = function deleteClass (req, res) {
  log.debug({params : req.params}, 'Deleting class');

  var tenantid = req.params.tenantid;
  var classid = req.params.classid;
  var etag = req.headers['if-match'];

  if (!etag) {
    return responses.missingEtag(res);
  }

  db.deleteClass(tenantid, classid, etag, function deletedClass (err) {
    if (err) {
      return dberrors.handle(err, [httpstatus.NOT_FOUND], 'Error occurred while attempting to delete class.', function returnResponse () {
        return responses.error(res, err);
      });
    }
    log.debug({class : classid}, 'Deleted class');
    responses.del(res);
  });
};