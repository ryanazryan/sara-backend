CREATE TABLE activity_reminders (
  idReminder INT UNSIGNED NOT NULL AUTO_INCREMENT,
  idAktivitas INT UNSIGNED NOT NULL,
  triggerAt DATETIME NOT NULL,
  expiresAt DATETIME NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  dueAt DATETIME(6) NULL,
  createdAt DATETIME(6) NOT NULL,
  updatedAt DATETIME(6) NOT NULL,
  CONSTRAINT pk_activity_reminders PRIMARY KEY (idReminder),
  CONSTRAINT fk_activity_reminders_activity FOREIGN KEY (idAktivitas)
    REFERENCES Aktivitas (idAktivitas) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT chk_activity_reminder_status CHECK (status IN ('PENDING', 'DUE', 'CANCELLED', 'EXPIRED')),
  INDEX idx_activity_reminders_parent (idAktivitas, idReminder),
  INDEX idx_activity_reminders_due (status, triggerAt, idReminder),
  INDEX idx_activity_reminders_expiry (status, expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
