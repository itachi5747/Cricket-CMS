const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');

const { uuidRequired } = commonValidators;

const listNotificationsQuerySchema = Joi.object({
  read:     Joi.boolean(),
  category: Joi.string().valid('match','payment','feedback','system','attendance','squad','performance'),
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(20),
});

const updatePreferencesSchema = Joi.object({
  email: Joi.boolean(),
  push:  Joi.boolean(),
  sms:   Joi.boolean(),
  categories: Joi.object({
    match:       Joi.boolean(),
    payment:     Joi.boolean(),
    feedback:    Joi.boolean(),
    system:      Joi.boolean(),
    attendance:  Joi.boolean(),
    squad:       Joi.boolean(),
    performance: Joi.boolean(),
  }),
}).min(1).messages({ 'object.min': 'At least one preference field required' });

const notificationIdParamSchema = Joi.object({
  notificationId: Joi.string().required(),
});

module.exports = {
  listNotificationsQuerySchema,
  updatePreferencesSchema,
  notificationIdParamSchema,
};
