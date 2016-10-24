var MTA = require('mta-service-status');
var TwitterPackage = require("twitter");
var cheerio = require('cheerio');
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

var Twitter = new TwitterPackage(secret);
var train = "F"  // The MTA feed doesn't include numbered trains.

function tweet(text) {
  Twitter.post('statuses/update',
               {status: text},
               function(error, tweet, response) {
                 try {
                   if (error) {
                     console.warn("Error tweeting:", error);
                     return
                   }
                   console.log("Tweeted:", tweet.text);
                 } catch (e) {
                   console.warn("Something went wrong", e);
                 }
               })
}

function retweet(tweetid) {
  Twitter.post('statuses/retweet',
               {id: tweetid},
               function(error, tweet, response) {
                 try {
                   if (error) {
                     console.warn("Error retweeting", tweetid, ":", error);
                     return
                   }
                   console.log("Tweeted:", tweet.text);
                 } catch (e) {
                   console.warn("Something went wrong", e);
                 }
               })
}

// Return an array of statuses to tweet. Since train status is batched by line,
// attempt to pull out relevant information. For example, E train information is
// provided as part of a single ACE status. If the status doesn't include [E],
// we skip it. We also skip less exciting stuff like alternate routes.
function make_tweets(html, tldr) {
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
      summary = tldr + ":" + text.replace(/(?:\r\n|\r|\n)/g, ' ');
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

/*** main ***/

// First check whether the MTA service status has anything interesting.
MTA.getServiceStatus('subway', train).then(function(result) {
  console.log("status of", train, "train:", result.status);
  if (result.status === "GOOD SERVICE") {
    console.log("good service");
    return;
  }
  try {
    statuses = make_tweets(result.html, result.status);
  } catch (e) {
    console.warn("Couldn't create tweets to post:", e);
    return
  }

  for (var i = 0; i < statuses.length; i++) {
    try {
      summary = statuses[i]
      console.log("Attempting to tweet:", summary);
      tweet(summary);
    } catch (e) {
      console.warn("Couldn't tweet:", e);
    }
  }
})

// Retweet anything the official NYCTSubway account has to say about the train.
var matchstring = " " + train + " ";
Twitter.get("statuses/user_timeline",
            {screen_name: 'NYCTSubway', count: 100, exclude_replies: true,
             include_rts: false}, function(error, data) {
              var skipped = []
              if (error) {
                console.log("Got an error:", error);
                return;
              }
              for (var i = 0; i < data.length ; i++) {
                var text = data[i].text;
                var id = data[i].id_str;
                if (text.includes(matchstring)) {
                  console.log("Attempting to retweet:", data[i].created_at, text, id);
                  retweet(id);
                } else {
                  skipped.push(text);
                }
              }
              console.log("Skipped", skipped.length, "irrelevant tweets.");
           })
