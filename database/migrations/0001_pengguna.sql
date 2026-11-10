CREATE TABLE Pengguna (
    idPengguna INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nama VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password VARCHAR(255) NOT NULL,
    tanggalDaftar DATE NOT NULL,

    CONSTRAINT pk_Pengguna
        PRIMARY KEY (idPengguna),

    CONSTRAINT uq_Pengguna_email
        UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
