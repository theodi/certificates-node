import express from 'express';
const router = express.Router();

router.get('/', function(req, res) {
    const page = {
      title: "About",
      link: "/about"
    };
    res.locals.page = page;
    res.render('pages/about/about');
  });
  router.get('/faq', function(req, res) {
    const page = {
      title: "FAQ",
      link: "/about/faq"
    };
    res.locals.page = page;
    res.render('pages/about/faq');
  });
  router.get('/ODC/what-you-need', function(req, res) {
    const page = {
      title: "What you need",
      link: "/about/odc/what-you-need"
    };
    res.locals.page = page;
    res.render('pages/odc/what-you-need');
  });
  router.get('/ODC/badge-levels', function(req, res) {
    const page = {
      title: "Badge Levels",
      link: "/about/odc/badge-levels"
    };
    res.locals.page = page;
    res.render('pages/odc/badge-levels');
  });
  router.get('/privacy', function(req, res) {
    const page = {
      title: "Privacy",
      link: "/about/privacy"
    };
    res.locals.page = page;
    res.render('pages/about/privacy');
  });
  router.get('/terms', function(req, res) {
    const page = {
      title: "Terms",
      link: "/about/terms"
    };
    res.locals.page = page;
    res.render('pages/about/terms');
  });
  router.get('/migration', function(req, res) {
    const page = {
      title: "Migration",
      link: "/about/migration"
    };
    res.locals.page = page;
    res.render('pages/about/migration');
  });
  export default router;