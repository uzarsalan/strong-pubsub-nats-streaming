"use-strict";

module.exports = Adapter;

var nats = require("node-nats-streaming");
var EventEmitter = require("events").EventEmitter;
var inherits = require("util").inherits;
var debug = require("debug")("strong-pubsub:nats");

function noop() {}

/**
 * The **nats** `Adapter`.
 *
 * @class
 */

function Adapter(client) {
  var adapter = this;
  this.client = client;
  var options = (this.options = client.options);
}

inherits(Adapter, EventEmitter);

Adapter.prototype.connect = function(cb) {
  var adapter = this;
  var client = this.client;
  var options = this.options;
  this.subClients = [];
  var stan = (this.natsClient = nats.connect(
    options.cluster,
    options.client,
    options.server
  ));

  var clientEmitter = (this.clientEmitter = new EventEmitter());

  stan.on("connect", clientEmitter.emit.bind(clientEmitter, "connect"));
  stan.on("error", clientEmitter.emit.bind(clientEmitter, "error"));

  this.clientEmitter.on("connect", function() {
    adapter.clientEmitter.removeListener("error", cb);
    cb();
  });

  this.clientEmitter.once("error", cb);

  stan.on("message", function(topic, message, options) {
    client.emit("message", topic, message, options);
  });
};

Adapter.prototype.end = function(cb) {
  var promises = [];
  this.subClients.forEach(element => {
    promises.push(
      new Promise((resolve, reject) => {
        element.unsubscribe();
        element.on("unsubscribed", () => {
          var index = this.subClients.indexOf(element);
          if (index > -1) {
            this.subClients.splice(index, 1);
          }
          resolve();
        });
      })
    );
  });

  Promise.all(promises)
    .then(() => {
      console.log("unsubscribed all");
      this.natsClient.close();
    })
    .catch(cb);
};

/**
 * Publish a `message` to the specified `topic`.
 *
 * @param {String} topic The topic to publish to.
 * @param {String|Buffer} message The message to publish to the topic.
 *
 * @callback {Function} callback Called once the adapter has successfully finished publishing the message.
 * @param {Error} err An error object is included if an error was supplied by the adapter.
 */

Adapter.prototype.publish = function(topic, message, options, cb) {
  this.natsClient.publish(topic, message, cb);
};

/**
 * Subscribe to the specified `topic` or **topic pattern**.
 *
 * @param {String} topic The topic to subscribe to.
 * @param {Object} options The NATS specific options. Get it this way client.adapter.subscriptionOptions(). More https://github.com/nats-io/node-nats-streaming/#subscription-start-ie-replay-options
 *
 * @callback {Function} callback Called once the adapter has finished subscribing.
 * @param {Error} err An error object is included if an error was supplied by the adapter.
 * @param {Object} subClient A client, subscribed on specific topic`.
 */

Adapter.prototype.subscribe = function(topic, options, cb) {
  let group = undefined;
  if (typeof topic !== 'string') {
    group = topic.group;
    topic = topic.topic;
  }
  if (Object.keys(options).length === 0 && options.constructor === Object)
    options = undefined;
  var subClient = this.natsClient.subscribe(topic, group || options, group ? options : null);
  this.subClients.push(subClient);
  cb(null, subClient);
};

Adapter.prototype.subscriptionOptions = function() {
  return this.natsClient.subscriptionOptions();
};

/**
 * Unsubscribe specific client.
 *
 * @param {String} subClient The client to unsubscribe.
 * @callback {Function} callback Called once the adapter has finished unsubscribing.
 * @param {Error} err An error object is included if an error was supplied by the adapter.
 */

Adapter.prototype.unsubscribe = function(subClient, cb) {
  subClient.unsubscribe();
  subClient.on("unsubscribed", () => {
    var index = this.subClients.indexOf(subClient);
    if (index > -1) {
      this.subClients.splice(index, 1);
    }
    cb();
  });
};
