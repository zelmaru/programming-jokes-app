require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
// no need to write require passport-local: it is one of dependencies needed by passport-local-mongoose
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const FacebookStrategy = require('passport-facebook').Strategy;
const {
  check,
  validationResult
} = require('express-validator');
// const { body } = require('express-validator');

const Schema = mongoose.Schema;
const app = express();

app.use(express.static(__dirname + "/public"));
// app.use(express.json());
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: true
}));
const urlencodedParser = bodyParser.urlencoded({
  extended: false
});

// initialize express-session code below app.use and above mongoose.connect

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize()); // initialize passport package
app.use(passport.session()); // use passport for dealing with the sessions

app.use(function(req, res, next) {
  res.locals.currentUser = req.user;
  next()
})

mongoose.connect('mongodb://localhost:27017/jokesDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true
});

const jokeSchema = new Schema({
  joke: {
    type: String,
    required: true
  },
  liked: {
    type: Boolean,
    default: false
  },
  flagged: {
    type: Boolean,
    default: false
  }
});

const Joke = new mongoose.model('Joke', jokeSchema)

const userSchema = new Schema({ // change the Schema into a full mongose schema
  email: String,
  password: String,
  googleId: String,
  facebookId: String,
  jokes: [jokeSchema]
});

// add a plugin to the userSchema
userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model('User', userSchema);

passport.use(User.createStrategy());


// use static serialize and deserialize of model for passport session support
// passport.serializeUser(User.serializeUser());
// passport.deserializeUser(User.deserializeUser());
// With google auth: Error: Failed to serialize user into session
// replace so it would work with any kind of authentification

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});


// google
passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/jokes",
    userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo'
  },
  function(accessToken, refreshToken, profile, cb) {
    console.log(profile);
    User.findOrCreate({
      googleId: profile.id
    }, function(err, user) {
      return cb(err, user);
    });
  }
));

// facebook
passport.use(new FacebookStrategy({
    clientID: process.env.APP_ID,
    clientSecret: process.env.APP_SECRET,
    callbackURL: "http://localhost:3000/auth/facebook/jokes",
    enableProof: true
  },
  function(accessToken, refreshToken, profile, done) {
    User.findOrCreate({
      facebookId: profile.id
    }, function(err, user) {
      if (err) {
        return done(err);
      }
      done(null, user);
    });
  }
));

/////////////////////// root route /////////////////////////////////

app.get('/', (req, res) => {
  // find all posted jokes and render them
  User.find({
    "jokes": {
      $ne: null
    }
  }, (err, foundUsers) => {
    if (err) {
      console.log(err);
    } else {
      console.log(foundUsers);
      res.render('home', {
        usersWithJokes: foundUsers
      });
    }
  })
});

/////////////////////// Google auth /////////////////////////////////

app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile']
  }));

app.get('/auth/google/jokes',
  passport.authenticate('google', {
    failureRedirect: '/login'
  }),
  function(req, res) {
    res.redirect('/submit');
  });

/////////////////////// Facebook auth /////////////////////////////////

app.get('/auth/facebook',
  passport.authenticate('facebook'));

app.get('/auth/facebook/jokes',
  passport.authenticate('facebook', {
    failureRedirect: '/login'
  }),
  function(req, res) {
    res.redirect('/submit');
  });

/////////////////////// Login/register routes /////////////////////////////////

app.get('/login', (req, res) => {
  res.render('login');
});


app.get('/register', (req, res) => {
  res.render('register');
});

/////////////////////// registration - classical  /////////////////////////////////

// validation using Express-validator:
// app.post('/register', (req, res) => {
//   User.find({email: req.body.username}, (err, userFound) => {
//     if (err) {
//       console.log(err);
//     } else {
//       if (userFound) {
//         const message = "Email already in use";
//         res.render('register', {
//           message: message
//         });
//       } else {
//         console.log("no user");
//       }
//     }
//   });
// },

 app.post('/register', urlencodedParser, [
  // check if username is an email
  check('username')
  .custom(async function(value){
			var user = await User.find({email:value})
			return user.length == 0;
		})
		.withMessage('Email already exists')
//   .custom(username => {
//    User.findOne({email: username}).exec(function(user) {
//        if (!user) {
//            return true;
//        }
//        else{
//            return false;
//        }
//     })
// }).withMessage('Email already in use.')
  .normalizeEmail()
  .isEmail().withMessage('Email must be a valid e-mail address'),
  // check if password confirmation matches the passsword
  check('password')
  .isLength({
    min: 5
  }).withMessage('Password must be at least 6 characters long')
  .custom((value, {
    req
  }) => {
    if (value !== req.body.passwordCheck) {
      throw new Error('Password confirmation is incorrect');
    } else {
      return true;
    }
  })
  // check the pasword length

], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const alert = errors.array();
    res.render('register', {
      alert: alert
    });
  }
  User.register({
    username: req.body.username
  }, req.body.password, (err, user) => {
    if (err) {
      console.log(err);
      // if this e-mail is already taken, alert (err.message):
      res.render('register', {message: err.message});
    } else {
      // the callback is only triggered if the auth was successful
      passport.authenticate('local')(req, res, () => {
        res.redirect('/submit');
      })
    }
  })
});

/////////////////////// login - classical  /////////////////////////////////

app.post('/login', urlencodedParser, [
  check('username', 'Email must be a valid e-mail address')
  .isEmail()
  .normalizeEmail(),
  check('password', 'Password must be at least 6 characters long')
  .isLength({
    min: 5
  })
], (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // return res.status(422).jsonp(errors.array());
    const alert = errors.array();
    res.render('login', {
      alert: alert
    })
  }
  const user = new User({
    username: req.body.username,
    password: req.body.password
  })
  req.login(user, (err) => {
    if (err) {
      console.log(err);
      // const message = "Invalid e-mail or password";
      // res.render('login', {alert: message})
    } else {
      passport.authenticate('local')(req, res, () => { // authenticate the user
        res.redirect('/submit');
      });
    }
  });
});

/////////////////////// Submit a joke  /////////////////////////////////

app.get('/submit', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('submit');
  } else {
    res.redirect('/login')
  }
});

app.post('/submit', (req, res) => {
  const joke = new Joke({
    joke: req.body.textarea
  });
  User.findById(req.user.id, (err, foundUser) => {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        foundUser.jokes.push(joke);
        foundUser.save(() => {
          res.redirect('/');

        })
      }
    }

  })

});

/////////////////////// Edit your jokes  /////////////////////////////////

app.get('/edit', (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user._id, (err, foundUser) => {
      if (err) {
        console.log(err);
      } else {
        if (foundUser) {
          res.render('edit', {
            postedJokes: foundUser.jokes
          });
        }
      }
    })
  } else {
    res.redirect('/login')
  }
});


// ---------- update --------------

app.post('/update', (req, res) => {
  if (req.isAuthenticated()) {
    const editedText = req.body.textarea;
    const jokeId = req.body.save;
    User.findOneAndUpdate({
      _id: req.user._id
    }, {
      $set: {
        "jokes.$[el].joke": editedText
      }
    }, {
      arrayFilters: [{
        "el._id": jokeId
      }],
      new: true
    }, (err, foundJoke) => {
      if (err) {
        console.log(err);
      } else {
        res.redirect("/edit");
      }
    });
    // res.redirect('/update/' + editJokeId);
  } else {
    res.redirect('/login');
  }
});




// ---------- delete --------------WORKING

app.post('/delete', (req, res) => {
  if (req.isAuthenticated()) {
    const jokeToDeleteId = req.body.delete;
    User.findOneAndUpdate({
      _id: req.user._id
    }, {
      $pull: {
        jokes: {
          _id: jokeToDeleteId
        }
      }
    }, (err, foundJoke) => { // findOne corresponds to finding a list (therefore findList)
      if (err) {
        console.log(err);
      } else {
        res.redirect("/edit");
      }
    });
  } else {
    res.redirect('/login')
  }
});



/////////////////////// search  /////////////////////////////////

app.get('/search', (req, res) => {
  // add post on first click, remove on second
});



// find all jokes that contain a particular string
// app.get("/search/:keyword", (req, res) => {
//   const keyword = "/" + req.params.keyword + "/i";
//   User.find({"jokes.joke": {$regex: keyword}},
//   {"jokes.$": 1}, // add that you need to project
//   (err, foundJokes) => {
//     if(err) {
//       console.log(err);
//     } else {
//       console.log(foundJokes);
//       if(foundJokes) {
//           res.render('found', {foundJokes: foundJokes});
//         } else {
//           res.send("No match found.");
//         }
//       }
//     })
// });
//
// app.post('/search', (req, res) => {
//   const keyword = req.body.search;
//   if (keyword.length < 1) {
//     res.render('found', {title: "No input."foundJokes: foundJokes});
//   }
// })


// Joke.find({joke: keyword}, (err, foundJokes) => {
//   if(foundJokes) {
//     res.render('found', {foundJokes: foundJokes});
//   } else {
//     res.send("No match found.");
//   }
// })


app.post('/search', (req, res) => {
  // add post on first click, remove on second
});

/////////////////////// on-click user actions /////////////////////////////////

app.get('/favourites', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('favourites');
  } else {
    res.redirect('/login')
  }
});

app.post('/favourites', (req, res) => {
  if (req.isAuthenticated()) {
    // add post on first click, remove on second
  } else {
    res.redirect('/login')
  }
});


app.post('/inappropriate', (req, res) => {
  if (req.isAuthenticated()) {
    // add post on first click, remove on second
  } else {
    res.redirect('/login')
  }
});






/////////////////////// account settings /////////////////////////////////

app.get('/settings', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('settings');
    // add post on first click, remove on second
  } else {
    res.redirect('/login')
  }
});

app.post('/settings', (req, res) => {
  if (req.isAuthenticated()) {
    // delete Account
    // add/ change email, username and password
  } else {
    res.redirect('/login')
  }
});


/////////////////////// account settings /////////////////////////////////


app.get('/terms', (req, res) => {
  res.render('terms');
})

app.get('/logout', (req, res) => {
  if (req.isAuthenticated()) {
    req.logout();
    res.redirect('/');
  } else {
    res.redirect('/login')
  }

})


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
