"use strict";
const Client = require("strong-pubsub");
const Adapter = require("strong-pubsub-nats-streaming");
const util = require("util");
const uuidv4 = require("uuid/v4");

let apm = require("elastic-apm-node");
if (!apm.isStarted()) {
    apm = apm.start();
}

const NATS_CLUSTER = "default";
const CLIENT_ID = "default";
const SERVER_URL = "nats://localhost:4222";

class Nats {
    constructor(
        cluster = NATS_CLUSTER,
        client_id = CLIENT_ID,
        server = SERVER_URL
    ) {
        const client = new Client(
            { cluster, client: client_id + "-" + uuidv4(), server },
            Adapter
        );

        this.cluster = cluster;
        this.client_id = client_id;
        this.server = server;
        this.client = client;

        this.client.on("error", err => {
            throw new Error(err);
        });

        this.client.on("connect", () => {});

        this._subscribe = util
            .promisify(this.client.subscribe)
            .bind(this.client);

        this.cbs = [];

        process.nextTick(async () => {
            (await this._subscribe(client_id)).on("message", msg => {
                msg = JSON.parse(msg.getData());
                if (this.cbs[msg.replyId]) {
                    clearTimeout(this.cbs[msg.replyId].timeoutId);
                    this.cbs[msg.replyId].cb(msg.err, msg.data);
                    delete this.cbs[msg.replyId];
                }
            });
        });
    }

    async publish(topic, data, replyCb, resultCb, opts) {
        if (typeof resultCb !== "function") {
            opts = resultCb;
            resultCb = createPromiseCallback();
        }
        const { replyRequired = false, replyTimeout = 15 * 1000 } = opts || {};

        data[
            "elastic-apm-traceparent"
        ] = apm.currentTransaction.context.toString();

        const message = {
            data,
            guid: uuidv4(),
            sender: this.client_id,
            replyRequired
        };

        if (typeof replyCb === "function") {
            const timeoutId = setTimeout(() => {
                replyCb(new Error("Reply timeout expired: " + replyTimeout));
                delete this.cbs[message.guid];
            }, replyTimeout);
            this.cbs[message.guid] = { cb: replyCb, timeoutId };
            message.replyRequired = true;
        }
        this.client.publish(topic, JSON.stringify(message), resultCb);
        return resultCb.promise;
    }

    async subscribe(topic, opts) {
        const subscriber = await this._subscribe(topic, opts);
        subscriber.on("message", msg => {
            msg = JSON.parse(msg.getData());
            const transaction = apm.startTransaction(
                msg.data.command || "Nats transaction",
                "Nats",
                msg.data["elastic-apm-traceparent"]
            );
            let cb;
            if (msg.replyRequired) {
                delete msg.replyRequired;
                cb = async (err, message) => {
                    return _reply(
                        {
                            to: msg.sender,
                            replyId: msg.guid,
                            data: message,
                            err
                        },
                        transaction,
                        this.client_id,
                        this.client
                    );
                };
            } else {
                process.nextTick(() => transaction.end());
            }
            subscriber.emit("data", msg.data, cb);
        });
        return subscriber;
    }

    async subscriptionOptions() {
        return this.client.adapter.subscriptionOptions();
    }
}

module.exports = Nats;

async function _reply({ to, ...data }, transaction, client_id, client) {
    const message = {
        ...data,
        guid: uuidv4(),
        sender: client_id
    };
    return util
        .promisify(client.publish)
        .bind(client)(to, JSON.stringify(message))
        .then(result => {
            transaction.end();
            return result;
        });
}

function createPromiseCallback() {
    let cb;
    const promise = new Promise(function(resolve, reject) {
        cb = function(err, data) {
            if (err) return reject(err);
            return resolve(data);
        };
    });
    cb.promise = promise;
    return cb;
}
