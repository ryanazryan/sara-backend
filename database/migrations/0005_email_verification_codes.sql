CREATE TABLE email_verification_codes (
  idPengguna INT UNSIGNED NOT NULL,
  codeHash CHAR(64) NOT NULL,
  expiresAt DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  CONSTRAINT pk_email_verification_codes PRIMARY KEY (idPengguna),
  CONSTRAINT fk_email_verification_codes_user
    FOREIGN KEY (idPengguna) REFERENCES Pengguna (idPengguna)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
