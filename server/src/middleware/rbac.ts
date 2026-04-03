// TODO: Role-Based Access Control middleware factory
// Usage: router.get('/vendors', requireRole(['ho']), handler)
// Roles: 'ho' | 'site' | 'mgmt'
// IMPORTANT: site role queries must also filter by req.user.site in controllers
