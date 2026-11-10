CREATE TABLE Aktivitas (
    idAktivitas INT UNSIGNED NOT NULL AUTO_INCREMENT,
    idPengguna INT UNSIGNED NOT NULL,
    idKegiatan INT UNSIGNED NULL,
    namaAktivitas VARCHAR(200) NOT NULL,
    waktuMulai DATETIME NULL,
    waktuSelesai DATETIME NULL,
    kategori VARCHAR(100) NULL,
    prioritas VARCHAR(50) NULL,
    lokasi VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL,

    CONSTRAINT pk_Aktivitas
        PRIMARY KEY (idAktivitas),

    INDEX idx_Aktivitas_Pengguna (idPengguna),

    CONSTRAINT fk_Aktivitas_Pengguna
        FOREIGN KEY (idPengguna)
        REFERENCES Pengguna (idPengguna)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,

    CONSTRAINT fk_Aktivitas_Kegiatan_owner
        FOREIGN KEY (idKegiatan, idPengguna)
        REFERENCES Kegiatan (idKegiatan, idPengguna)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
