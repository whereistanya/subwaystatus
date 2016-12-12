var MTA = require('mta-service-status');
var TwitterPackage = require("twitter");
var cheerio = require('cheerio');
var RedisPackage = require('redis');
var Promise = require('bluebird');

var async = require("async");

require('console-stamp')(console, '[HH:MM:ss.l]');

var secret = require("./credentials_subwaystatus");
/* Create a twitter account, generate keys at apps.twitter.com, and add a file
called credentials_subwaystatus.json containing:

{
    "consumer_key": "ADD_KEY_HERE",
    "consumer_secret": "ADD_SECRET_HERE",
    "access_token_key": "ADD_KEY_HERE",
    "access_token_secret": "ADD_SECRET_HERE"
}
*/

var redis = RedisPackage.createClient(); // default to localhos:6379

var Twitter = new TwitterPackage(secret);

Promise.promisifyAll(Twitter);

var train = "F"  // The MTA feed doesn't include numbered trains.

function tweet(text, success_cb) {
  console.log("tweeting", text);
  var success = 0;
  Twitter.postAsync('statuses/update', {status: this.text})
    .then(function(error, tweet, response) {
      console.log("Tweeted:", tweet);
      success_cb(null);
    }.bind({text: text}))
    .catch(function (e) {
      success_cb(e);
    });
}

function retweet(tweetid, success_cb) {
  console.log("retweeting", tweetid);
  var success = 0;
  Twitter.postAsync('statuses/retweet', {id: tweetid})
    .then(function(error, tweet, response) {
      console.log("Retweeted:", tweet);
      success_cb(1);
    }.bind({text: text}))
    .catch(function (e) {
      success_cb(e);
    });
}

// Return an array of statuses to tweet. Since train status is batched by line,
// attempt to pull out relevant information. For example, E train information is
// provided as part of a single ACE status. If the status doesn't include [E],
// we skip it. We also skip less exciting stuff like alternate routes.
function make_tweets(html) {
  var parsedHTML = cheerio.load(html);
  var lines = parsedHTML.text().split(/\r\n\s*\r\n/);
  matchstring = "[" + train + "]";

  var keep = []
  var skipped = []
  for (var i = 0; i < lines.length; i++) {
    var text = lines[i].trim();
    if (text.includes(matchstring)) {
      if (text.indexOf("For service ", 0) === 0) {
        continue;
      }
      if (text.indexOf("Travel Alternatives", 0) === 0) {
        continue;
      }
      if (text.indexOf("From", 0) === 0) {
        continue;
      }
      summary = text.replace(/(?:\r\n|\r|\n)/g, ' ');
      keep.push(summary.slice(0, 140));
    } else {
      skipped.push(text);
    }
  }
  if (keep.length == 0) {
    console.log("Skipped", skipped.length, "irrelevant lines.");
  }
  return keep;
}

function set_redis (key) {
  try {
    redis.set(key, 1);
    redis.expire(key, 43200);  //12h
  } catch (e) {
    console.log("Error writing to redis (key:", key, "):", e);
  }
}

var get_statuses = function(callback) {
  var statuses = []
  MTA.getServiceStatus('subway', train).then(function(result) {
    console.log("status of", train, "train:", result.status);

    if (result.status === "GOOD SERVICE") {
      console.log("good service");
      callback(null, []);
      return;
    }
    try {
      statuses = make_tweets(result.html);
    } catch (e) {
      console.warn("Couldn't create tweets to post:", e);
    }
    callback(null, statuses);
  });
}

var get_retweetable_ids = function(callback) {
  var twittersearch = {
    "NYCTSubway": " " + train + " ",
    "amNewYork": train + " train",
    "DNAinfoNY": train + " train",
  }
  var tried = 0;
  for (user in twittersearch) {
    var ids = []
    var matchstring = twittersearch[user];

    Twitter.get("statuses/user_timeline",
      { screen_name: user, count: 50, exclude_replies: true, include_rts: false
      }, function(error, data) {
        var skipped = []
        if (error) {
          console.log("Error reading timeline for user", user, ":", error);
        }
        for (var i = 0; i < data.length ; i++) {
          var text = data[i].text;
          var id = data[i].id_str;
          if (text.includes(matchstring)) {
            ids.push(id);
          }
        }
        if (++tried == Object.keys(twittersearch).length) {
          callback(null, ids);
        }
      });
  }
}

var tweet_mta_feed = function(statuses, callback) {
  var tried = 0;
  for (var i = 0; i < statuses.length; i++) {
    text = statuses[i];
    redis.exists(text, function(err, reply) {
      if (reply == 1) {
        console.log("Already tweeted [", this.text, "].Skipping.");
      } else {
        tweet(this.text, function(err) {
          if (!err) {
            set_redis(this.text);
          } else {
            console.log("got an error tweeting", this.text, ":", err);
          }
        }.bind({text: this.text}));
      }
      if (++tried == statuses.length) {
        callback();
      }
    }.bind({text: text}));
  }
}

var retweet_local_news = function(ids, callback) {
  var tried = 0;
  for (var i = 0; i < ids.length; i++) {
    id = ids[i];

    redis.exists(id, function(err, reply) {
      if (reply == 1) {
        console.log("Already retweeted [", this.id, "]. Skipping.");
        if (++tried == ids.length) {
          callback();
        }
      } else {
        retweet(this.id, function(err) {
          if (!err) {
            set_redis(this.id);
          } else {
            console.log("Got an error retweeting:", err);
          }
          // TODO: Shouldn't need to check this twice in this function.
          if (++tried == ids.length) {
            callback();
          }
        }.bind( { id: this.id }));
      }
    }.bind( { id: id }));
  }
}

/*** main ***/

redis.on('connect', function() {
  console.log("Connected to redis.");
});
redis.on('error', function(err) {
  console.log("Error connecting to redis:", err);
});

redis.incr("subwaystatus:runs", function(err, reply) {
  console.log("Beginning run", reply);
});

async.waterfall(
[
  function(callback) {
    get_statuses(callback)
  },
  function(statuses, callback) {
    tweet_mta_feed(statuses, callback)
  },
  function(callback) {
    get_retweetable_ids(callback)
  },
  function(ids, callback) {
    retweet_local_news(ids, callback)
  },
], function(err) { //Final callback
    redis.quit();
  });
