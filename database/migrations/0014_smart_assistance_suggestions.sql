CREATE TABLE smart_assistance_suggestions (
  idSuggestion CHAR(36) NOT NULL,
  idPengguna INT UNSIGNED NOT NULL,
  idAktivitas INT UNSIGNED NOT NULL,
  state VARCHAR(16) NOT NULL,
  originalFingerprint CHAR(64) NOT NULL,
  optionsJson JSON NOT NULL,
  contextJson JSON NOT NULL,
  selectedIndex INT UNSIGNED NULL,
  resultJson JSON NULL,
  createdAt DATETIME(6) NOT NULL,
  expiresAt DATETIME(6) NOT NULL,
  appliedAt DATETIME(6) NULL,
  CONSTRAINT pk_smart_assistance_suggestions PRIMARY KEY (idSuggestion),
  CONSTRAINT fk_smart_assistance_user FOREIGN KEY (idPengguna)
    REFERENCES Pengguna (idPengguna) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_smart_assistance_activity FOREIGN KEY (idAktivitas)
    REFERENCES Aktivitas (idAktivitas) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT chk_smart_assistance_state CHECK (state IN ('READY', 'NO_SLOTS', 'APPLIED')),
  INDEX idx_smart_assistance_owner (idPengguna, createdAt),
  INDEX idx_smart_assistance_expiry (state, expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
