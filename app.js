require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
// passport-local is already one of the dependencies for passport-local-mongoose
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const FacebookStrategy = require('passport-facebook').Strategy;
const {
  check,
  validationResult
} = require('express-validator');
const request = require('request');
const nodemailer = require("nodemailer");


const app = express();

app.use(express.static(__dirname + "/public"));

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: true
}));
const urlencodedParser = bodyParser.urlencoded({
  extended: false
});

// initialize express-session

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
  useCreateIndex: true,
  useFindAndModify: false
});

const Schema = mongoose.Schema;

const jokeSchema = new Schema({
  joke: {
    type: String,
    required: true,
    unique: true
  },
  timestamp: {type: Date, default: Date.now }
});

const Joke = new mongoose.model('Joke', jokeSchema)

const userSchema = new Schema({ // change the Schema into a full mongose schema
  email: {
    type: String,
    unique: true
  },
  password: String,
  googleId: String,
  facebookId: String,
  jokes: [jokeSchema]
});


// set passport-local-mongoose error message options

const options = {
  errorMessages: {
    MissingPasswordError: 'No password was given',
    IncorrectPasswordError: 'Password or e-mail are incorrect',
    IncorrectUsernameError: 'Password or e-mail are incorrect',
    MissingUsernameError: 'No e-mail was given',
    UserExistsError: 'A user with the given e-mail is already registered'
  }
};

// add a plugin to the userSchema
userSchema.plugin(passportLocalMongoose, options);
userSchema.plugin(findOrCreate);

const User = new mongoose.model('User', userSchema);

passport.use(User.createStrategy());

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
    // console.log(profile);
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

// validate registration form using express-validator
app.post('/register', urlencodedParser, [
  check('username')
  .normalizeEmail()
  .isEmail().withMessage('E-mail must be a valid e-mail address'),
  check('password')
  .isLength({
    min: 6
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
      res.render('register', {
        message: err.message
      });
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
  check('username')
  .isEmail().withMessage('E-mail must be a valid e-mail address')
  .normalizeEmail(),
  check('password')
  .isLength({
    min: 6
  }).withMessage('Password must be at least 6 characters long')
], (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
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
    if (!user) {}
    if (err) {
      console.log(err);
      res.render('login', {
        message: err.message
      });
    } else {
      passport.authenticate('local', {
        failureRedirect: '/login'
      })(req, res, () => { // authenticate the user
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
    res.render('login', {
      flash: "To submit a joke, you have to log in first"
    });
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
          User.find({
            "jokes": {
              $ne: null
            }
          }, (err, foundUsers) => {
            if (err) {
              console.log(err);
            } else {
                res.render('home', {
                usersWithJokes: foundUsers,
                greenFlash: "Your joke was successfully added"
              });
            }
          })
        })
      }
    }
  })
});

/////////////////////// edit /////////////////////////////////

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
    res.render('login', {
      flash: "To edit jokes, you have to log in first"
    });
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
        User.findById(req.user._id, (err, foundUser) => {
          if (err) {
            console.log(err);
          } else {
            if (foundUser) {
              res.render('edit', {
                postedJokes: foundUser.jokes,
                greenFlash: "Changes were successfully saved"
              });
            }
          }
        })
      }
    });
  } else {
    res.render('login', {
      flash: "To update a joke, you have to log in first"
    });
  }
});




// ---------- delete --------------

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
    }, (err, foundJoke) => {
      if (err) {
        console.log(err);
      } else {
        User.findById(req.user._id, (err, foundUser) => {
          if (err) {
            console.log(err);
          } else {
            if (foundUser) {
              res.render('edit', {
                postedJokes: foundUser.jokes,
                greenFlash: "Joke was successfully deleted"
              });
            }
          }
        })
      }
    });
  } else {
    res.render('login', {
      flash: "To delete a joke, you have to log in first"
    });
  }
});

/////////////////////// random joke /////////////////////////////////

app.get('/random', (req, res) => {
  // find all existing jokes, then in EJS file choose random one to display
  User.find({
    "jokes": {
      $ne: null
    }
  }, (err, foundUsers) => {
    if (err) {
      console.log(err);
    } else {
        res.render('random', {
        usersWithJokes: foundUsers
      });
    }
  })
});

/////////////////////// terms /////////////////////////////////

app.get('/terms', (req, res) => {
  res.render('terms');
})

/////////////////////// log out /////////////////////////////////

app.get('/logout', (req, res) => {
  if (req.isAuthenticated()) {
    req.logout();
    res.redirect('/');
  } else {
    res.redirect('/');
  }
})

app.post('/signup', (req, res) => {

  const {
    firstName,
    lastName,
    email
  } = req.body
  if (!firstName || !lastName || !email) {
    User.find({
      "jokes": {
        $ne: null
      }
    }, (err, foundUsers) => {
      if (err) {
        console.log(err);
      } else {
          res.render('failure', {
          usersWithJokes: foundUsers,
          signFlash: "All fields are required. Try again."
        });
      }
    })
    return
  }

  const data = {
    members: [{
      email_address: email,
      status: 'subscribed',
      merge_fields: {
        FNAME: firstName,
        LNAME: lastName
      }
    }]
  }

  const postData = JSON.stringify(data)

  const options = {
    url: process.env.MAILCHIMP_URL,
    method: 'POST',
    headers: {
      Authorization: process.env.MAILCHIMP_AUTH
    },
    body: postData
  }

  request(options, (err, response, body) => {
    if (err) {
      User.find({
        "jokes": {
          $ne: null
        }
      }, (err, foundUsers) => {
        if (err) {
          console.log(err);
        } else {
          res.render('failure', {
            usersWithJokes: foundUsers,
            signFlash: "Something went wrong. Try again."
          });
        }
      })
    } else {
      if (response.statusCode === 200) {
        User.find({
          "jokes": {
            $ne: null
          }
        }, (err, foundUsers) => {
          if (err) {
            console.log(err);
          } else {
            res.render('success', {
              usersWithJokes: foundUsers,
              greenSignFlash: "You were successfully subcribed."
            });
          }
        });
      } else {
        User.find({
          "jokes": {
            $ne: null
          }
        }, (err, foundUsers) => {
          if (err) {
            console.log(err);
          } else {
            res.render('failure', {
              usersWithJokes: foundUsers,
              signFlash: "Something went wrong. Try again."
            });
          }
        })
      }
    }
  })
})


/////////////////////// success /////////////////////////////////

app.get('/success', (req, res) => {
  res.render('success');
})


/////////////////////// failure /////////////////////////////////

app.get('/failure', (req, res) => {
  res.render('failure');
})


////////////////////// contact form //////////////////////////////


app.get('/contact', (req, res) => {
  res.render('contact');
})
// POST route from contact form
app.post('/contact', urlencodedParser, [
check('usersEmail')
.isEmail().withMessage("E-mail must be a valid e-mail address")
.normalizeEmail(),
check('message')
.isLength({
  min: 10
}).withMessage('Message must be at least 10 characters long')

], (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const alert = errors.array();
    res.render('contact', {
      alert: alert
    })
  }

  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_MY_MAIL,
      pass: process.env.GMAIL_MY_PASSWORD
    }
  });

  let mailOptions = {
    from: req.body.usersEmail,
    to: process.env.GMAIL_MY_MAIL,
    subject: 'Programming Jokes - New Message',
    text: req.body.message
  }


  // send the e-mail
  transporter.sendMail(mailOptions, (error, data) => {
    if (error) {
      console.log(error);
      res.render('contact', {errFlash: "An error occured. Try again."})
    }
    else {
      res.render('contact', {okFlash: "Your message was successfully sent."})
    }
  })
})


///////////////////////// port /////////////////////////////////

const host = '0.0.0.0'
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
