var MTA = require('mta-service-status');
var TwitterPackage = require("twitter");
var cheerio = require('cheerio');

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

function make_tweet(text) {
  var parsedHTML = cheerio.load(text);
  var text = parsedHTML.text().trim().replace(
    /(?:\r\n|\r|\n)/g, '').replace(/\s\s+/g, ' ');

  summary = text.slice(0, 140);
  return summary;
}

/*** main ***/

// First check whether the MTA service status has anything interesting.
MTA.getServiceStatus('subway', train).then(function(result) {
  console.log("status of", train, "train:", result.status);
  var summary = ""
  try {
    summary = make_tweet(result.html);
  } catch (e) {
    console.warn("Couldn't create a tweet to post:", e);
    return
  }

  switch(result.status) {
    case "GOOD SERVICE":
      summary = "Everything is ok.";
      break;
    case "DELAYS":
      break;
    case "PLANNED WORK":
      break;
    default:
      console.log("Got unexpected status:", result.status);
      break;
  }

  if (summary) {
    console.log("Attempting to tweet:", summary);
    tweet(summary);
  } else {
    console.log("No summary. Not tweeting");
  }
})

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
