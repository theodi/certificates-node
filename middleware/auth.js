import fs from 'fs';
import path from 'path';

const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    const err = new Error('Forbidden');
    err.status = 403;
    next(err);
};

const ensureAuthenticatedPrivate = (req, res, next) => {
    // Full path to the requested file in the /private directory
    const filePath = path.join(process.cwd(), 'private', req.path);

    // If file doesn't exist, skip auth and let Express 404 handler deal with it
    if (!fs.existsSync(filePath)) {
        return next();
    }

    // Check authentication
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }

    // Browser request → redirect to login
    console.log(filePath);
    res.redirect('/auth/django');
};

export { ensureAuthenticated, ensureAuthenticatedPrivate };
