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

  // ── Transactional emails (MailRenderer composes blocks: heading + body + a CTA
  // button → deepLink, plus the shared code hint / signoff / footer chrome) ──
  'email.passwordReset.subject': 'Reset your Drovery password',
  'email.passwordReset.heading': 'Reset your password',
  'email.passwordReset.body':
    "Tap the button below to reset your Drovery password. This link expires in 1 hour. If you didn't request it, you can safely ignore this email.",
  'email.passwordReset.cta': 'Reset password',
  'email.verification.subject': 'Verify your Drovery email',
  'email.verification.heading': 'Verify your email',
  'email.verification.body':
    'Welcome to Drovery! Tap the button below to verify your email address. This link expires in 24 hours.',
  'email.verification.cta': 'Verify email',
  'email.common.codeHint': 'Or enter this code in the app: {token}',
  'email.common.signoff': '— The Drovery team',
  'email.common.footer': 'Drovery · Autonomous drone delivery',

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

  // ── Thrown HTTP errors (one key per literal; the filter translates at the boundary) ──
  // Cross-cutting authz / user.
  'error.authz.forbidden': 'Insufficient permissions',
  'error.authz.access_denied': 'Access denied',
  'error.user.not_found': 'User not found',

  // Delivery.
  'error.delivery.not_found': 'Delivery with id "{id}" not found',
  'error.delivery.not_found_by_tracking_id':
    'Delivery with tracking id "{trackingId}" not found',
  'error.delivery.schedule.too_far':
    'Pickup can be scheduled at most {maxDays} days ahead.',
  'error.delivery.schedule.live_not_allowed':
    'A LIVE-tracked delivery cannot be scheduled for a future pickup window.',
  'error.delivery.tracking_id_alloc_failed':
    'Could not allocate a unique tracking id, please retry.',
  'error.delivery.serviceability.unresolved_location':
    "We couldn't locate the pickup or dropoff. Pick the points on the map and try again.",
  'error.delivery.serviceability.not_flyable':
    'This delivery cannot be flown right now.',
  'error.serviceability.OUT_OF_AREA':
    'Pickup or dropoff is outside our service area.',
  'error.serviceability.NO_FLY_ZONE':
    'Route is restricted near {zoneName} (no-fly zone).',
  'error.serviceability.WEATHER_STORM':
    'A storm is grounding drones at this location right now.',
  'error.serviceability.WEATHER_HOLD':
    'High wind is grounding drones right now ({windKph} kph).',
  'error.delivery.cancel.bad_status':
    'Delivery cannot be canceled in "{status}" status. Only {allowed} deliveries can be canceled.',
  'error.delivery.cancel.race_bad_status':
    'Delivery cannot be canceled in "{status}" status.',
  'error.delivery.fail.bad_status':
    'Delivery cannot be failed in "{status}" status.',
  'error.delivery.handoff.already_completed':
    'This delivery has already been completed.',
  'error.delivery.handoff.not_awaiting':
    'This delivery is not awaiting handoff yet.',
  'error.delivery.handoff.invalid_code': 'Invalid handoff code.',
  'error.delivery.handoff.locked':
    'Too many incorrect attempts — the handoff is locked.',
  'error.delivery.proof.not_found': 'No proof of delivery for delivery "{id}"',
  'error.delivery.rating.not_delivered':
    'You can only rate a delivery once it has been delivered.',
  'error.delivery.rating.not_rated': 'Delivery "{id}" has not been rated yet',
  'error.delivery.tracking.not_found':
    'Tracking data for delivery "{id}" not found',

  // Drone commands.
  'error.command.not_found': 'Command not found',
  'error.command.live_only': 'Only LIVE deliveries can be commanded',
  'error.command.no_drone': 'Delivery has no assigned drone',
  'error.command.illegal_for_status':
    'Cannot {type} a delivery in status {status}',
  'error.command.limit_reached': 'Command limit reached for this delivery',
  'error.command.already_pending':
    'A command is already pending for this delivery',
  'error.command.drone_not_assigned': 'Drone is not assigned to this delivery',
  'error.command.expired': 'Command has expired',
  'error.command.not_awaiting_ack': 'Command is not awaiting acknowledgement',

  // Telemetry (request-side; the ingest-guard machine messages stay English).
  'error.telemetry.latlng_pair_required':
    'lat and lng must be provided together',
  'error.telemetry.not_live': 'Delivery is not live-tracked',
  'error.telemetry.drone_not_assigned':
    'Drone is not assigned to this delivery',

  // Auth. The two invalid-credentials + the token messages are deliberately vague
  // (anti-enumeration) — DO NOT add detail in any locale.
  'error.auth.email_taken': 'A user with this email already exists',
  'error.auth.signup_failed': 'Could not complete signup, please try again',
  'error.auth.invalid_credentials': 'Invalid email or password',
  'error.auth.refresh_invalid': 'Refresh token is invalid or has been revoked',
  'error.auth.user_gone': 'User no longer exists',
  'error.auth.reset_token_invalid': 'Invalid or expired reset token',
  'error.auth.verify_token_invalid': 'Invalid or expired verification token',

  // Admin.
  'error.admin.ticket.not_found': 'Ticket "{id}" not found',
  'error.admin.ticket.closed': 'This ticket is closed; reopen it first.',
  'error.admin.refund.invalid_amount':
    'Refund must be greater than 0 and at most the charged total.',
  'error.admin.refund.already_refunded':
    'This delivery has already been refunded.',
  'error.admin.promo.code_exists':
    'A promo code with that code already exists.',
  'error.admin.promo.not_found': 'Promo "{id}" not found',
  'error.admin.promo.percent_range':
    'A PERCENT discountValue must be between 0 and 100.',
  'error.admin.user.not_found': 'User "{id}" not found',
  'error.admin.user.last_admin': 'Cannot demote the last remaining admin.',

  // Payment.
  'error.payment.method.not_found': 'Payment method with id "{id}" not found',

  // Recurring deliveries.
  'error.recurring.end_before_start': 'endDate must be on or after startDate.',
  'error.recurring.weekly_needs_days':
    'WEEKLY schedules require at least one day in daysOfWeek.',
  'error.recurring.no_future_occurrence':
    'This schedule produces no future occurrence (check the time, days, and end date).',
  'error.recurring.not_found': 'Recurring delivery "{id}" not found',
  'error.recurring.already_ended': 'This recurrence has already ended.',

  // Saved addresses / favorites / workflows / geo / support / wallet.
  'error.saved_address.not_found': 'Saved address with id "{id}" not found',
  'error.saved_address.limit': 'You can save at most {max} addresses.',
  'error.favorite.not_found': 'Favorite "{id}" not found',
  'error.workflow.not_found': 'Workflow "{workflowId}" not found',
  'error.workflow.step_not_found':
    'Step "{stepId}" does not exist in workflow "{workflowId}"',
  'error.geo.q_required': 'Query parameter "q" is required',
  'error.geo.latlng_required':
    'Query parameters "lat" and "lng" are required and must be numbers',
  'error.support.message_required': 'Message is required',
  'error.support.ticket.not_found': 'Support ticket not found',
  'error.support.ticket.closed': 'This support ticket is closed',
  'error.wallet.insufficient_credits': 'Insufficient wallet credits.',
  'error.notification.not_found': 'Notification with id "{id}" not found',
  'error.notification.quiet_hours_pair':
    'quietHoursStart and quietHoursEnd must be set together (or both cleared)',
};
