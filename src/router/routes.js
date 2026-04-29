const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/HomePage.vue') },
      { path: 'status', component: () => import('pages/FerryStatusPage.vue') },
      { path: 'webcams', component: () => import('pages/WebcamsPage.vue') },
      { path: 'rides', component: () => import('pages/RidesPage.vue') },
      { path: 'rides/post', component: () => import('pages/PostRidePage.vue') },
      { path: 'rides/:id/edit', component: () => import('pages/PostRidePage.vue') },
      { path: 'rides/:id', component: () => import('pages/RideDetailPage.vue') },
      { path: 'alerts', component: () => import('pages/AlertsPage.vue') },
      { path: 'map', component: () => import('pages/MapPage.vue') },
      { path: 'settings', component: () => import('pages/SettingsPage.vue') },
    ]
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue')
  }
]

export default routes
