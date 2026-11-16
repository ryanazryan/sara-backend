CREATE TABLE aktivitas_history (
  idHistory BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idPengguna INT UNSIGNED NOT NULL,
  idAktivitas INT UNSIGNED NOT NULL,
  eventType VARCHAR(16) NOT NULL,
  oldStatus VARCHAR(50) NULL,
  newStatus VARCHAR(50) NULL,
  changes JSON NOT NULL,
  occurredAt DATETIME(6) NOT NULL,
  CONSTRAINT pk_aktivitas_history PRIMARY KEY (idHistory),
  INDEX idx_aktivitas_history_owner (idPengguna, idHistory),
  INDEX idx_aktivitas_history_activity (idPengguna, idAktivitas, idHistory),
  CONSTRAINT fk_aktivitas_history_user FOREIGN KEY (idPengguna)
    REFERENCES Pengguna (idPengguna) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
