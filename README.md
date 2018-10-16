# strong-pubsub-nats-streaming

**[NATS](https://nats.io/) `Adapter` for strong-pubsub**

## Installation

```
$ npm install strong-pubsub-nats-streaming
```

## Use

```js
module.exports = async function(app) {
  var Client = require("strong-pubsub");
  var Adapter = require("loopback-pubsub-nats");

  var client = new Client({ cluster: "test-cluster", client: "test" }, Adapter);

  client.connect();

  client.on("error", err => {
    console.log(err);
  });

  client.on("connect", () => {
    console.log("connected");

    var opts = client.adapter.subscriptionOptions();
    client.subscribe("test", (err, subClient) => {
      console.log("subscribed");
      subClient.on("message", msg => {
        console.log(
          "Received a message [" + msg.getSequence() + "] " + msg.getData()
        );
      });

      setTimeout(() => {
        client.end();
      }, 5000);

      setInterval(() => {
        client.publish("test", "test", (err, resp) => {
          if (err) console.log(err);
          console.log("published: ", resp);
        });
      }, 1000);
    });
  });
};
```
