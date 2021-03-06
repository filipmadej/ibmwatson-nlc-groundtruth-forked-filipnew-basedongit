/**
 * Copyright 2015 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

'use strict';

var async = require('async');
var httpstatus = require('http-status');
var makeArray = require('make-array');

// local dependencies
var cache = require('../job/cache');
var restutils = require('../../components/restutils');
var db = require('../../config/db/store');
var dberrors = require('../../config/db/errors');
var log = require('../../config/log');
var io = require('../../config/socket');

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
  log.debug({ body : req.body, params : req.params }, 'Creating class');

  var tenantid = req.params.tenantid;
  var classattrs = req.body;

  if (!classattrs || !Object.keys(classattrs).length) {
    return responses.badrequest('Missing request body', res);
  }

  db.createClass(tenantid, classattrs, function returnNewClass (err, classification) {
    if (err) {
      io.to(tenantid).emit('class:create', { attributes : classattrs, err : err });
      return dberrors.handle(err, [httpstatus.BAD_REQUEST], 'Error occurred while attempting to create class.', function returnResponse () {
        return responses.error(res, err);
      });
    }

    classification.id = classification._id;
    delete classification._id;
    log.debug({ class : classification }, 'Created class');

    io.to(tenantid).emit('class:create', { attributes : classification });
    responses.newitem(
      classification,
      req.baseUrl + req.route.path, {
        ':tenantid' : tenantid, ':classid' : classification.id
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
      io.to(tenantid).emit('class:update', { id : classid, name : classattrs.name, err : err });
      return dberrors.handle(err, [httpstatus.BAD_REQUEST], 'Error occurred while attempting to replace class.', function returnResponse () {
        return responses.error(res, err);
      });
    }
    log.debug({class : classid}, 'Replaced class');
    io.to(tenantid).emit('class:update', { id : replaced._id, name : replaced.name });
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
      io.to(tenantid).emit('class:delete', { id : classid, err : err });
      return dberrors.handle(err, [httpstatus.NOT_FOUND], 'Error occurred while attempting to delete class.', function returnResponse () {
        return responses.error(res, err);
      });
    }
    log.debug({class : classid}, 'Deleted class');
    io.to(tenantid).emit('class:delete', { id : classid });
    responses.del(res);
  });
};

module.exports.deleteClasses = function deleteClasses (req, res) {
  log.debug({params : req.params}, 'Deleting classes');

  var tenantid = req.params.tenantid;
  var ids = req.body;

  if (!ids || !Object.keys(ids).length) {
    return responses.badrequest('Missing request body', res);
  }

  var details = {
      status : cache.STATUS.RUNNING,
      success : 0,
      error : 0
  };

  var jobid = cache.entry(details);

  async.eachLimit(ids, 5, function doDelete (id, next) {
    db.deleteClass(tenantid, id, '*', function deletedClass (err) {
      if (err) {
        var message = 'Error occurred while attempting to delete class.';
        if (err.statusCode === httpstatus.NOT_FOUND) {
          log.debug({ message : err.message, error : err.error }, message);
        } else {
          log.error({ err : err }, message);
        }
        details.error++;
        io.to(tenantid).emit('class:delete', { id : id, err : err });
      } else {
        log.debug({class : id}, 'Deleted class');
        details.success++;
        io.to(tenantid).emit('class:delete', { id : id });
      }

      next();
    });
  }, function onEnd (err) {
      if (err) {
        details.status = cache.STATUS.ERROR;
      } else {
        details.status = cache.STATUS.COMPLETE;
      }

      cache.put(jobid, details);
    });

  responses.accepted(
    req.baseUrl + '/jobs/:jobid',
    {
      ':tenantid' : tenantid,
      ':jobid' : jobid
    },
    res);
};
