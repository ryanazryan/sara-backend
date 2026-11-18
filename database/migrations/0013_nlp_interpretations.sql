CREATE TABLE nlp_interpretations (
  idInterpretation CHAR(36) NOT NULL,
  idPengguna INT UNSIGNED NOT NULL,
  intent VARCHAR(32) NOT NULL,
  state VARCHAR(24) NOT NULL,
  structuredDraft JSON NOT NULL,
  missingFields JSON NOT NULL,
  issues JSON NOT NULL,
  timeZone VARCHAR(80) NOT NULL,
  referenceAt DATETIME(6) NOT NULL,
  expiresAt DATETIME(6) NOT NULL,
  confirmedAt DATETIME(6) NULL,
  confirmedHash CHAR(64) NULL,
  resultJson JSON NULL,
  CONSTRAINT pk_nlp_interpretations PRIMARY KEY (idInterpretation),
  CONSTRAINT fk_nlp_interpretations_user FOREIGN KEY (idPengguna)
    REFERENCES Pengguna (idPengguna) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT chk_nlp_interpretations_state CHECK (state IN ('READY', 'NEEDS_CLARIFICATION', 'CONFIRMED')),
  INDEX idx_nlp_interpretations_owner (idPengguna, expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
