const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/HomePage.vue') },
      // The direction is part of the path so the two halves of the history are
      // separately linkable; omitting it falls back to the page's default.
      // Non-default weeks / holiday settings ride in the query string.
      { path: 'history/:direction(bowen|hsb)?', component: () => import('pages/HistoryPage.vue') },
      // Old path — the page has always been the sailing history. Kept as a
      // redirect so bookmarks and links already out in the world still land.
      { path: 'status', redirect: '/history' },
      { path: 'bowen-departures', component: () => import('pages/BowenDeparturesPage.vue') },
      { path: 'leaderboard', component: () => import('pages/LeaderboardPage.vue') },
      // Was 'profile'. The page grew past a profile — display preferences and
      // notifications live here too — so it is Settings now, with the old path
      // redirecting rather than breaking links already shared.
      { path: 'settings', component: () => import('pages/SettingsPage.vue') },
      { path: 'profile', redirect: '/settings' },
      { path: 'rides', component: () => import('pages/RidesPage.vue') },
      { path: 'rides/post', component: () => import('pages/PostRidePage.vue') },
      { path: 'rides/:id/edit', component: () => import('pages/PostRidePage.vue') },
      { path: 'rides/:id', component: () => import('pages/RideDetailPage.vue') },
      { path: 'map', component: () => import('pages/MapPage.vue') },
      { path: 'classifier-results', component: () => import('pages/ClassifierResultsPage.vue') },
    ]
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue')
  }
]

export default routes
