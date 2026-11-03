/** BullMQ queue names. Each queue has a consumer in the worker process. */
export const QUEUES = {
  domainEvents: 'domain-events',
  media: 'media',
  notifications: 'notifications',
  webhooks: 'webhooks',
  scheduled: 'scheduled',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
