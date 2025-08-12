// authRoutes.js

import express from 'express';
import passport from '../passport.js'; // Import the passport module

import { ensureAuthenticated } from '../middleware/auth.js';
import { retrieveOrCreateUser } from '../controllers/user.js';
import User from '../models/User.js';
const router = express.Router();

async function processLogin(req, res) {
  try {
    const profile = req.session.passport ? req.session.passport.user : req.session.user;
    // Normalize name/email to strings for model validation
    const safeProfile = {
      email: typeof profile?.email === 'string' ? profile.email : undefined,
      name: typeof profile?.name === 'string' ? profile.name : [profile?.givenName, profile?.familyName].filter(Boolean).join(' ').trim()
    };
    const user = await retrieveOrCreateUser(safeProfile);

    // Update last login data
    user.lastLoginFormatted = user.lastLogin.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    user.lastLogin = new Date();
    user.signInCount = user.signInCount + 1;

    // Save the user
    await user.save();

    req.session.passport.user.id = user._id;
    // Stash summary fields for easy access in views
    req.session.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      lastLogin: user.lastLoginFormatted,
      signInCount: user.signInCount
    };

    /* TODO: Add Hubspot integration
    if (req.session.authMethod !== 'local') {
      await getHubspotUser(user._id,user.email);
    }
    */

  } catch (error) {
    console.log(error);
  }
}

// Authentication route for Google
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Authentication route for Django
router.get('/django',
  passport.authenticate('django')
);

// Callback endpoint for Google authentication
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/error' }),
  async (req, res) => {
    req.session.authMethod = 'google';
    await processLogin(req);
    res.redirect('/auth/profile');
  }
);

// Callback endpoint for Django authentication
router.get('/django/callback',
  passport.authenticate('django', { failureRedirect: '/error' }),
  async (req, res) => {
    req.session.authMethod = 'django';
    await processLogin(req);
    res.redirect('/auth/profile');
  }
);

router.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

router.get('/profile', ensureAuthenticated, async (req, res) => {
  const page = { title: 'Profile page', link: '/profile' };
  res.locals.page = page;

  try {
    const sessionUser = req.session.passport ? req.session.passport.user : req.session.user;
    let userDoc = null;
    if (sessionUser?.id) {
      userDoc = await User.findById(sessionUser.id).lean();
    } else if (sessionUser?.email) {
      userDoc = await User.findOne({ email: sessionUser.email }).lean();
    }

    if (userDoc) {
      return res.render('pages/auth/profile', { user: userDoc });
    }
  } catch (e) {
    // fall back below
  }

  // Fallback to whatever is in locals/session if DB lookup failed
  const fallbackUser = req.session.user || (req.session.passport ? req.session.passport.user : null) || {};
  res.render('pages/auth/profile', { user: fallbackUser });
});

export default router;