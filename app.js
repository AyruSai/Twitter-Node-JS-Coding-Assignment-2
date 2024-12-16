const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({ filename: databasePath, driver: sqlite3.Database });

    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error:${error.message}`);
    process.exit(1);
  }
};
initializeDbAndServer();

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

const validatePassword = (password) => {
  return password.length > 5;
};

// API 1 POST register new user
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (dbUser === undefined) {
    const createUserQuery = `
    INSERT INTO
        user(username, password, name, gender)
    VALUES
        (
            '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
        );`;
    if (validatePassword(password)) {
      await database.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);
  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    );
    if (isPasswordMatched === true) {
      const payload = { username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3 GET tweets
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const getFollowingUsersQuery = `
  SELECT
    following_user_id
  FROM
    follower
  WHERE
    follower_user_id = ${dbUser.user_id};`;
  const followingUsersArray = await database.all(getFollowingUsersQuery);
  const followingUsers = followingUsersArray.map((eachUser) => {
    return eachUser["following_user_id"];
  });

  const getTweetsQuery = `
  SELECT
    username, tweet, date_time AS dateTime
  FROM
    tweet
  INNER JOIN
    user
  ON
    tweet.user_id = user.user_id
  WHERE
    tweet.user_id IN (
        ${followingUsers}
    )
  ORDER BY
    dateTime DESC
  LIMIT 4;
  `;
  const tweets = await database.all(getTweetsQuery);
  response.send(tweets);
});

// API 4 GET user following names
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const userId = dbUser["user_id"];

  const getUserFollowingNamesQuery = `
  SELECT
    name
  FROM
    user
  INNER JOIN
    follower
  ON
    follower.following_user_id = user.user_id
  WHERE
    follower_user_id = ${userId};
  `;
  const userFollowing = await database.all(getUserFollowingNamesQuery);
  response.send(userFollowing);
});

// API 5 GET user followers names
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const userId = dbUser["user_id"];

  const getUserFollowersNamesQuery = `
  SELECT
    name
  FROM
    user
  INNER JOIN
    follower
  ON
    follower.follower_user_id = user.user_id
  WHERE
    following_user_id = ${userId};
  `;
  const userFollowers = await database.all(getUserFollowersNamesQuery);
  response.send(userFollowers);
});

const isUserFollowing = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const userId = dbUser["user_id"];

  const getFollowingUsersQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${userId};`;
  const followingUsers = await database.all(getFollowingUsersQuery);

  const userTweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;
  const tweetData = await database.get(userTweetQuery);
  const tweetUserId = tweetData["user_id"];

  let isTweetUserIdInFollowingIds = false;
  followingUsers.forEach((eachId) => {
    if (eachId["following_user_id"] === tweetUserId) {
      isTweetUserIdInFollowingIds = true;
    }
  });
  if (isTweetUserIdInFollowingIds) {
    next();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
};

// API 6 GET tweet
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetsQuery = `
    SELECT
        tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime
    FROM
        tweet
    WHERE
        tweet.tweet_id = ${tweetId};`;
    const tweets = await database.get(getTweetsQuery);
    response.send(tweets);
  }
);

// API 7 GET likes  usernames
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetLikesQuery = `
    SELECT
        username
    FROM
        like
    NATURAL JOIN
        user
    WHERE
        tweet_id = ${tweetId};
    `;

    const tweetLikes = await database.all(getTweetLikesQuery);
    const usernamesArray = tweetLikes.map((eachLike) => eachLike.username);
    response.send({ likes: usernamesArray });
  }
);

// API 8 GET list of replies
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `
    SELECT
        name, reply
    FROM
        reply
    NATURAL JOIN
        user
    WHERE
        tweet_id = ${tweetId};
    `;
    const repliesArray = await database.all(getRepliesQuery);
    response.send({
      replies: repliesArray,
    });
  }
);

// API 9 GET all tweets
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const userId = dbUser["user_id"];

  const getLikesQuery = `
    SELECT
      tweet, COUNT() AS likes, date_time AS dateTime
    FROM
        tweet
    INNER JOIN
        like
    ON
        tweet.tweet_id = like.tweet_id
    WHERE
        tweet.user_id = ${userId}
    GROUP BY
        tweet.tweet_id;
    `;
  const likesArray = await database.all(getLikesQuery);

  const getRepliesQuery = `
  SELECT
    tweet, COUNT() AS replies
  FROM
    tweet
  INNER JOIN
    reply
  ON
    tweet.tweet_id = reply.tweet_id
  WHERE
    tweet.user_id = ${userId}
  GROUP BY
    tweet.tweet_id;
  `;
  const repliesArray = await database.all(getRepliesQuery);

  likesArray.forEach((eachArray) => {
    for (let result of repliesArray) {
      if (eachArray.tweet === result.tweet) {
        eachArray.replies = result.replies;
        break;
      }
    }
  });
  response.send(likesArray);
});

// API 10 POST create tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  const userId = dbUser["user_id"];

  const createTweetQuery = `
  INSERT INTO
    tweet (tweet, user_id)
  VALUES
    ('${tweet}', ${userId});
  `;
  await database.run(createTweetQuery);
  response.send("Created a Tweet");
});

// API 11 DELETE tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const dbUser = await database.get(selectUserQuery);
    const getTweetQuery = `
  SELECT
    *
  FROM
    tweet
  WHERE
    tweet_id = ${tweetId};
  `;
    const tweetDetails = await database.get(getTweetQuery);
    if (dbUser.user_id !== tweetDetails.user_id) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
      DELETE FROM
        tweet
      WHERE
        tweet_id = ${tweetId};
      `;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
