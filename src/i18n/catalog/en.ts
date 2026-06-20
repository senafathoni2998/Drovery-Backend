/**
 * Authoritative English catalog. Every key the app uses MUST exist here (other
 * locales fall back to these per key). The strings are the EXACT prior literals
 * from STAGES, exceptionComms, MailService and SupportService/FAQS, so English
 * users see no change. `{placeholder}` tokens are interpolated by I18nService.
 */
export const en: Record<string, string> = {
  // ── Delivery lifecycle (simulation stage) notifications + live-map labels ──
  'notification.stage.CONFIRMED.title': 'Delivery Confirmed',
  'notification.stage.CONFIRMED.body':
    'Your delivery has been confirmed and is being processed.',
  'notification.stage.CONFIRMED.droneStatus': 'Delivery confirmed',
  'notification.stage.DRONE_ASSIGNED.title': 'Drone Assigned',
  'notification.stage.DRONE_ASSIGNED.body':
    'A drone has been assigned to your delivery.',
  'notification.stage.DRONE_ASSIGNED.droneStatus': 'Drone assigned',
  'notification.stage.PICKUP_IN_PROGRESS.title': 'Pickup In Progress',
  'notification.stage.PICKUP_IN_PROGRESS.body':
    'The drone is heading to the pickup location.',
  'notification.stage.PICKUP_IN_PROGRESS.droneStatus':
    'On the way to Pickup Location',
  'notification.stage.IN_TRANSIT.title': 'Package In Transit',
  'notification.stage.IN_TRANSIT.body':
    'Your package has been picked up and is on its way!',
  'notification.stage.IN_TRANSIT.droneStatus': 'En route to destination',
  'notification.stage.AWAITING_HANDOFF.title': 'Awaiting Handoff',
  'notification.stage.AWAITING_HANDOFF.body':
    'Your package has arrived. Share your handoff code with the recipient to complete delivery.',
  'notification.stage.AWAITING_HANDOFF.droneStatus':
    'Awaiting recipient handoff',

  // ── Delivery exception notifications + live-map labels ──
  'notification.exception.WEATHER_ABORT.title': 'Delivery Aborted — Weather',
  'notification.exception.WEATHER_ABORT.body':
    'Unsafe weather forced your drone to abort. Your payment has been refunded to your wallet.',
  'notification.exception.WEATHER_ABORT.droneStatus': 'Aborted — weather',
  'notification.exception.MECHANICAL.title': 'Delivery Failed',
  'notification.exception.MECHANICAL.body':
    'A technical issue grounded the drone. Your payment has been refunded to your wallet.',
  'notification.exception.MECHANICAL.droneStatus': 'Grounded — technical issue',
  'notification.exception.UNSAFE_DROP_ZONE.title': "Couldn't Complete Delivery",
  'notification.exception.UNSAFE_DROP_ZONE.body':
    "The drone couldn't find a safe spot to drop your package. Your payment has been refunded.",
  'notification.exception.UNSAFE_DROP_ZONE.droneStatus':
    'Aborted — unsafe drop zone',
  'notification.exception.RECIPIENT_UNAVAILABLE.title': 'Handoff Failed',
  'notification.exception.RECIPIENT_UNAVAILABLE.body':
    "We couldn't verify the recipient after several attempts, so the delivery was stopped. Contact support if you need a refund.",
  'notification.exception.RECIPIENT_UNAVAILABLE.droneStatus':
    'Stopped — recipient unavailable',
  'notification.exception.ADMIN_ABORT.title': 'Delivery Stopped',
  'notification.exception.ADMIN_ABORT.body':
    'Your delivery was stopped by support. Your payment has been refunded to your wallet.',
  'notification.exception.ADMIN_ABORT.droneStatus': 'Stopped by support',
  'notification.exception.OTHER.title': 'Delivery Failed',
  'notification.exception.OTHER.body':
    "Your delivery couldn't be completed. Your payment has been refunded to your wallet.",
  'notification.exception.OTHER.droneStatus': 'Delivery failed',
  'notification.exception.RETURNING.title': 'Drone Returning to Base',
  'notification.exception.RETURNING.body':
    'Your drone is heading back. You can watch it return live on the map.',
  'notification.exception.RETURNING.droneStatus': 'Returning to base',
  'notification.exception.RETURNED.title': 'Drone Returned Safely',
  'notification.exception.RETURNED.body':
    'Your package made it back to base. Your payment has been refunded to your wallet.',
  'notification.exception.RETURNED.droneStatus': 'Returned to base',

  // ── Transactional emails ──
  'email.passwordReset.subject': 'Reset your Drovery password',
  'email.passwordReset.body':
    "Tap to reset your password: {deepLink}\n\nOr enter this code in the app: {token}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.",
  'email.verification.subject': 'Verify your Drovery email',
  'email.verification.body':
    'Welcome to Drovery! Tap to verify your email: {deepLink}\n\nOr enter this code in the app: {token}\n\nThis link expires in 24 hours.',

  // ── Support ──
  'support.autoAck':
    "Thanks for reaching out to Drovery support! We've received your message and a member of our team will get back to you shortly. Feel free to add any other details here in the meantime.",
  'faq.1.question': 'How do I track my delivery?',
  'faq.1.answer':
    'Go to the Delivery tab and tap on your active order. You will see real-time tracking on the map.',
  'faq.2.question': 'How is the delivery price calculated?',
  'faq.2.answer':
    'Pricing is based on package size, weight, type, and a base service fee. Use the Price Estimate tool before placing an order.',
  'faq.3.question': 'Can I cancel an order?',
  'faq.3.answer':
    'You can cancel an order before a drone is assigned. Once assigned, cancellation may incur a fee.',
  'faq.4.question': 'What package sizes are available?',
  'faq.4.answer':
    'Small (up to 0.5 kg), Medium (up to 1.5 kg), Large (up to 3 kg), and XL (up to 5 kg).',
  'faq.5.question': 'How do I change my default address?',
  'faq.5.answer':
    'Go to Profile → Edit Profile and update the Default Address field.',
  'faq.6.question': 'Is my payment information secure?',
  'faq.6.answer':
    'Yes. All card data is encrypted via Stripe. We never store your full card number.',

  // ── Validation (class-validator → boundary-localized; {property} stays the raw field) ──
  'validation.isString': '{property} must be a string',
  'validation.isNotEmpty': '{property} is required',
  'validation.isNumber': '{property} must be a number',
  'validation.isInt': '{property} must be an integer',
  'validation.isBoolean': '{property} must be true or false',
  'validation.isArray': '{property} must be a list',
  'validation.isEmail': '{property} must be a valid email',
  'validation.isPositive': '{property} must be a positive number',
  'validation.isEnum': '{property} must be one of: {values}',
  'validation.isIn': '{property} must be one of: {values}',
  'validation.min': '{property} must be at least {min}',
  'validation.max': '{property} must be at most {max}',
  'validation.minLength': '{property} must be at least {min} characters',
  'validation.maxLength': '{property} must be at most {max} characters',
  'validation.isLength':
    '{property} must be between {min} and {max} characters',
  'validation.arrayMinSize': '{property} must contain at least {min} item(s)',
  'validation.arrayMaxSize': '{property} must contain at most {max} item(s)',
  'validation.matches': '{property} has an invalid format',
  'validation.isDateString': '{property} must be a valid date',
  'validation.isISO8601': '{property} must be a valid ISO 8601 date',
  'validation.whitelistValidation': '{property} is not an allowed property',
  'validation.invalid': '{property} is invalid',
  'validation.code.sixDigit': 'code must be a 6-digit number',
  'validation.timeOfDay.format': 'timeOfDay must be HH:MM (24-hour)',
};
