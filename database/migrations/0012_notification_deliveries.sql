CREATE TABLE notification_deliveries (
  idNotification BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idReminder INT UNSIGNED NOT NULL,
  idDevice INT UNSIGNED NOT NULL,
  reminderRevision INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  nextAttemptAt DATETIME(6) NOT NULL,
  leaseUntil DATETIME(6) NULL,
  providerMessageId VARCHAR(255) NULL,
  lastErrorCode VARCHAR(64) NULL,
  createdAt DATETIME(6) NOT NULL,
  updatedAt DATETIME(6) NOT NULL,
  CONSTRAINT pk_notification_deliveries PRIMARY KEY (idNotification),
  CONSTRAINT fk_notification_deliveries_reminder FOREIGN KEY (idReminder)
    REFERENCES activity_reminders (idReminder) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_notification_deliveries_device FOREIGN KEY (idDevice)
    REFERENCES notification_devices (idDevice) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT uq_notification_delivery_revision UNIQUE (idReminder, idDevice, reminderRevision),
  CONSTRAINT chk_notification_delivery_status CHECK (status IN ('QUEUED','SENDING','RETRY','ACCEPTED','FAILED','SKIPPED')),
  INDEX idx_notification_delivery_dispatch (status, nextAttemptAt, idNotification),
  INDEX idx_notification_delivery_device (idDevice, idNotification)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
