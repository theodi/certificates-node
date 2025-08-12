// auth.js

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

// Passport setup for Google authentication
passport.use('google', new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  (accessToken, refreshToken, profile, done) => {
    try {
      const email = Array.isArray(profile.emails) && profile.emails[0] ? profile.emails[0].value : undefined;
      const displayName = profile.displayName || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(' ').trim();
      const user = {
        provider: 'google',
        providerId: profile.id,
        email,
        name: displayName || email || 'Unknown User'
      };
      return done(null, user);
    } catch (e) {
      return done(e);
    }
  }
));

// Passport setup for Django authentication
passport.use('django', new OAuth2Strategy({
  authorizationURL: 'https://theodi.org/auth/authorize/',
  tokenURL: 'https://theodi.org/auth/token/',
  clientID: process.env.DJANGO_CLIENT_ID,
  clientSecret: process.env.DJANGO_CLIENT_SECRET,
  callbackURL: process.env.DJANGO_CALLBACK_URL,
  grant_type: 'authorization_code', // Specify grant type
  pkce: true, // Enable PKCE,
  scope: "read",
  state: true,
  passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
  fetch('https://theodi.org/api/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to fetch user profile');
    }
    return response.json();
  })
  .then(userProfile => {
    const name = [userProfile.first_name, userProfile.last_name].filter(Boolean).join(' ').trim();
    const user = {
      provider: 'django',
      providerId: userProfile.id || profile?.id,
      email: userProfile.email,
      name: name || userProfile.email || 'Unknown User'
    };
    return done(null, user);
  })
  .catch(error => {
    console.error('Error fetching user profile:', error);
    return done(error);
  });
}));

// Serialize and deserialize user
passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

export default passport;