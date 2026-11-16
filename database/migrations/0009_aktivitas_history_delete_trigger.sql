CREATE TRIGGER trg_aktivitas_hist_delete
AFTER DELETE ON Aktivitas
FOR EACH ROW
INSERT INTO aktivitas_history
  (idPengguna, idAktivitas, eventType, oldStatus, newStatus, changes, occurredAt)
VALUES
  (OLD.idPengguna, OLD.idAktivitas, 'DELETED', OLD.status, NULL,
   JSON_OBJECT('before', JSON_OBJECT(
     'namaAktivitas', OLD.namaAktivitas,
     'idKegiatan', OLD.idKegiatan,
     'waktuMulai', OLD.waktuMulai,
     'waktuSelesai', OLD.waktuSelesai,
     'kategori', OLD.kategori,
     'prioritas', OLD.prioritas,
     'lokasi', OLD.lokasi,
     'status', OLD.status
   )), UTC_TIMESTAMP(6));
