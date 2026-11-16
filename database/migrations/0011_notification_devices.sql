CREATE TABLE notification_devices (
  idDevice INT UNSIGNED NOT NULL AUTO_INCREMENT,
  idPengguna INT UNSIGNED NOT NULL,
  installationId VARCHAR(128) NOT NULL,
  platform VARCHAR(12) NOT NULL,
  fcmToken TEXT NULL,
  tokenHash CHAR(64) NULL,
  notificationPermission VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN',
  active TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME(6) NOT NULL,
  updatedAt DATETIME(6) NOT NULL,
  CONSTRAINT pk_notification_devices PRIMARY KEY (idDevice),
  CONSTRAINT fk_notification_devices_user FOREIGN KEY (idPengguna)
    REFERENCES Pengguna (idPengguna) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT uq_notification_devices_installation UNIQUE (idPengguna, installationId),
  CONSTRAINT uq_notification_devices_token UNIQUE (tokenHash),
  CONSTRAINT chk_notification_devices_platform CHECK (platform IN ('android', 'ios')),
  CONSTRAINT chk_notification_devices_permission CHECK (notificationPermission IN ('GRANTED', 'DENIED', 'UNKNOWN')),
  INDEX idx_notification_devices_owner_active (idPengguna, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
