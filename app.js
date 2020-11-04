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

const Schema = mongoose.Schema;
const app = express();

app.use(express.static(__dirname + "/public"));
// app.use(express.json());
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({extended: true}));

// initialize express-session code below app.use and above mongoose.connect

app.use(session({
  secret: 'Blah blah blah.',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());  // initialize passport package
app.use(passport.session());  // use passport for dealing with the sessions

app.use(function (req, res, next) {
  res.locals.currentUser = req.user;
  next()
})

mongoose.connect('mongodb://localhost:27017/jokesDB', {useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex:true});

const jokeSchema = new Schema({
  joke: String
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
    User.findOrCreate({ googleId: profile.id }, function (err, user) {
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
    User.findOrCreate({facebookId: profile.id}, function(err, user) {
      if (err) { return done(err); }
      done(null, user);
    });
  }
));

/////////////////////// root route /////////////////////////////////

app.get('/', (req, res) => {
  User.find({"jokes": {$ne: null}}, (err, foundUsers) => {
    if (err) {
      console.log(err);
    } else {
      res.render('home', {usersWithJokes: foundUsers});
    }
  })
});

/////////////////////// Google auth /////////////////////////////////

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile'] }));

  app.get('/auth/google/jokes',
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    res.redirect('/submit');
  });

  /////////////////////// Facebook auth /////////////////////////////////

  app.get('/auth/facebook',
   passport.authenticate('facebook'));

app.get('/auth/facebook/jokes',
  passport.authenticate('facebook', { failureRedirect: '/login' }),
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

app.post('/register', (req, res) => {
  User.register({ username: req.body.username}, req.body.password, (err, user) => {
    if (err) {
      console.log(err);
      res.redirect('/register');
    } else {
      passport.authenticate('local')(req, res, () => { // the callback is only triggered if the auth was successful
        res.redirect('/');
      })
    }
  }
)
});

/////////////////////// login - classical  /////////////////////////////////

app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const user = new User({
    username: req.body.username,
    password: req.body.password
  })
  req.login(user, (err) => {
    if (err) {
      console.log(err);
    } else {
      passport.authenticate('local')(req, res, () => { // authenticate the user
        res.render('home')
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
  const joke = new Joke ({
    joke: req.body.joke
  });
  User.findById(req.user.id, (err, foundUser) => {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        foundUser.jokes.push(joke);
        foundUser.save(()=> {
          res.redirect('/');
        })
      }
    }

  })

});

/////////////////////// Edit your jokes  /////////////////////////////////

app.get('/edit', (req, res) => {

  User.findById(req.user._id, (err, foundUser) => {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        res.render('edit', {postedJokes: foundUser.jokes});
      }
    }
  })
});

// ---------- update --------------

app.post('/update', (req, res) => {
  const editJokeId = req.body.update;
  res.redirect('/update/' + req.body.update);
});


app.get('/update/:jokeId', (req, res) => {
const jokeId = req.params.jokeId;
User.findById({_id: req.user._id, "jokes._id": jokeId}, {"jokes.joke": 1}, (err, foundJoke) => {
  if (err) {
    console.log(err);
  } else {
    console.log(foundJoke);
    res.render('update', {jokeToEdit: foundJoke});
    }
});
});



// ---------- delete --------------WORKING

app.post('/delete', (req, res) => {
    const jokeToDeleteId = req.body.delete;
          User.findOneAndUpdate({_id: req.user._id}, {$pull: {jokes: {_id: jokeToDeleteId}}}, (err, foundJoke) => { // findOne corresponds to finding a list (therefore findList)
          if (err) {
            console.log(err);
          } else {
            res.redirect("/edit");
          }
        });
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
res.render('favourites');
});

app.post('/favourites', (req, res) => {
// add post on first click, remove on second
});


app.post('/inappropriate', (req, res) => {
  // add post on first click, remove on second
});






/////////////////////// account settings /////////////////////////////////

app.get('/settings', (req, res) => {
res.render('settings');
});

app.post('/settings', (req, res) => {
  // delete Account
  // add/ change email, username and password
});


/////////////////////// account settings /////////////////////////////////


app.get('/terms', (req, res) => {
  res.render('terms');
})

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
})


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
