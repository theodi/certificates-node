import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import surveysRouter from './routes/surveys.js';
import datasetsRouter from './routes/datasets.js';
import redirectsRouter from './routes/redirects.js';
import aboutRouter from './routes/about.js';
import session from 'express-session';
import logger from 'morgan';
import passport from './passport.js';
import authRoutes from './routes/auth.js';
import { ensureAuthenticatedPrivate } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3080;
app.set('view engine', 'ejs');
app.use(cors());

// Middleware for logging
app.use(logger('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Sessions
app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET,
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  res.locals.user = req.session.passport ? req.session.passport.user : req.session.user;
  next();
});

app.use((req, res, next) => {
  // Read package.json file
  fs.readFile(path.join(__dirname, 'package.json'), 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading package.json:', err);
          return next();
      }

      try {
          const packageJson = JSON.parse(data);
          // Extract version from package.json
          var software = {};
          software.version = packageJson.version;
          software.homepage = packageJson.homepage;
          software.versionLink = packageJson.homepage + "/releases/tag/v" + packageJson.version;
          res.locals.software = software;
      } catch (error) {
          console.error('Error parsing package.json:', error);
      }
      next();
  });
});

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1.
  res.setHeader('Pragma', 'no-cache'); // HTTP 1.0.
  res.setHeader('Expires', '0'); // Proxies.
  next();
});

app.use(express.static(__dirname + '/public')); // Public directory

// Auth routes
app.use('/auth', authRoutes);
app.use('/about', aboutRouter);
// Extension-based routes for datasets (must come before the main datasets router)
app.get('/datasets.json', (req, res, next) => {
  req.url = '/datasets';
  req.headers.accept = 'application/json';
  return datasetsRouter(req, res, next);
});
app.get('/datasets.html', (req, res, next) => {
  req.url = '/datasets';
  req.headers.accept = 'text/html';
  return datasetsRouter(req, res, next);
});
app.get('/datasets.feed', (req, res, next) => {
  req.url = '/datasets';
  req.headers.accept = 'application/atom+xml';
  return datasetsRouter(req, res, next);
});
app.get('/datasets.rss', (req, res, next) => {
  req.url = '/datasets';
  req.headers.accept = 'application/rss+xml';
  return datasetsRouter(req, res, next);
});
app.get('/datasets.xml', (req, res, next) => {
  req.url = '/datasets';
  req.headers.accept = 'application/atom+xml';
  return datasetsRouter(req, res, next);
});

// Extension-based routes for individual datasets (must come before the main datasets router)
app.get('/datasets/:datasetId.feed', (req, res, next) => {
  req.url = `/datasets/${req.params.datasetId}/certificates`;
  req.headers.accept = 'application/atom+xml';
  return datasetsRouter(req, res, next);
});
app.get('/datasets/:datasetId.rss', (req, res, next) => {
  req.url = `/datasets/${req.params.datasetId}/certificates`;
  req.headers.accept = 'application/rss+xml';
  return datasetsRouter(req, res, next);
});
app.get('/datasets/:datasetId.xml', (req, res, next) => {
  req.url = `/datasets/${req.params.datasetId}/certificates`;
  req.headers.accept = 'application/atom+xml';
  return datasetsRouter(req, res, next);
});

app.use('/datasets', datasetsRouter);
app.use('/surveys', surveysRouter);
app.use('/', redirectsRouter);

app.get('/admin', function(req,res) {
  res.redirect('/auth/google');
});

app.get('/', function(req, res) {
  const page = {
    title: "Home",
    link: "/"
  };
  res.locals.page = page;
  res.render('pages/home');
});

// Connect to MongoDB for loading surveys from the database
(async () => {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/open_data_certificate';
  try {
    await mongoose.connect(mongoUrl);
    console.log('Connected to MongoDB for survey loading');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
  }
})();

app.use('/data', surveysRouter);

app.use(ensureAuthenticatedPrivate, express.static(__dirname + '/private')); // Private directory

// Error handling
app.get('/error', (req, res) => res.send("error logging in"));

app.get('*', function(req, res, next){
  const page = {
    title: "404 Not Found"
  };
  res.locals.page = page;
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  
  // Default status code for unhandled errors
  let statusCode = 500;
  let errorMessage = "Internal Server Error";
  
  // Check if the error has a specific status code and message
  if (err.status) {
    statusCode = err.status;
    errorMessage = err.message;
  }
  
  // Provide more specific error messages based on status code
  if (statusCode === 401) {
    errorMessage = "Authentication Required";
  } else if (statusCode === 403) {
    errorMessage = "Access Denied";
  } else if (statusCode === 404) {
    errorMessage = "Page Not Found";
  } else if (statusCode === 500) {
    errorMessage = "Internal Server Error";
  }
  
  const page = {
    title: "Error"
  };
  res.locals.page = page;

  // Log the error stack trace for debugging (uncomment if needed)
  // console.error(err.stack);

  // Content negotiation based on request Accept header
  const acceptHeader = req.get('Accept');

  if (acceptHeader === 'application/json') {
    // Respond with JSON
    res.status(statusCode).json({ 
      error: errorMessage,
      status: statusCode,
      message: errorMessage 
    });
  } else {
    // Respond with HTML (rendering an error page)
    res.status(statusCode).render('errors/error', { statusCode, errorMessage });
  }
});

// Start server
app.listen(port , () => console.log('App listening on port ' + port));