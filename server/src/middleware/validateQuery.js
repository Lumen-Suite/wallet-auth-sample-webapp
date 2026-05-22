import { z } from 'zod'

export const loginConfigBody = z.object({
  AllowedLoginMethods: z.object({
    Wallets: z.array(z.enum(['METAMASK'])).optional(),
    SocialMedia: z.array(z.enum(['GOOGLE', 'FACEBOOK'])).optional(),
  }).refine(
    (m) => (m.Wallets?.length || 0) + (m.SocialMedia?.length || 0) > 0,
    { message: 'At least one login method (Wallets or SocialMedia) must be provided' },
  ),
  RedirectURL: z.string().url(),
}).passthrough()

export function validateQuery(schema, source = 'query') {
  return (req, _res, next) => {
    const data = source === 'body' ? req.body : req.query
    const result = schema.safeParse(data)
    if (!result.success) {
      const err = new Error(result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '))
      err.status = 400
      return next(err)
    }
    if (source === 'body') req.body = result.data
    else req.query = result.data
    next()
  }
}

export function requireUserToken(req, _res, next) {
  const t = req.headers['lumen-user-token']
  if (!t) {
    const err = new Error('Missing lumen-user-token header')
    err.status = 401
    return next(err)
  }
  req.userToken = t
  next()
}
