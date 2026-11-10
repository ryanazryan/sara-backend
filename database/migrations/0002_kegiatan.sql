CREATE TABLE Kegiatan (
    idKegiatan INT UNSIGNED NOT NULL AUTO_INCREMENT,
    idPengguna INT UNSIGNED NOT NULL,
    namaKegiatan VARCHAR(200) NOT NULL,
    deskripsi TEXT NULL,
    estimasiDurasi INT UNSIGNED NULL,

    CONSTRAINT pk_Kegiatan
        PRIMARY KEY (idKegiatan),

    CONSTRAINT uq_Kegiatan_owner
        UNIQUE (idKegiatan, idPengguna),

    CONSTRAINT fk_Kegiatan_Pengguna
        FOREIGN KEY (idPengguna)
        REFERENCES Pengguna (idPengguna)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
