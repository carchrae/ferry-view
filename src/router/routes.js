const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/HomePage.vue') },
      { path: 'status', component: () => import('pages/FerryStatusPage.vue') },
      { path: 'rides', component: () => import('pages/RidesPage.vue') },
      { path: 'rides/post', component: () => import('pages/PostRidePage.vue') },
      { path: 'rides/:id/edit', component: () => import('pages/PostRidePage.vue') },
      { path: 'rides/:id', component: () => import('pages/RideDetailPage.vue') },
      { path: 'map', component: () => import('pages/MapPage.vue') },
    ]
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue')
  }
]

export default routes
