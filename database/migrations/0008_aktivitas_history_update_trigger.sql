CREATE TRIGGER trg_aktivitas_hist_update
AFTER UPDATE ON Aktivitas
FOR EACH ROW
INSERT INTO aktivitas_history
  (idPengguna, idAktivitas, eventType, oldStatus, newStatus, changes, occurredAt)
VALUES
  (NEW.idPengguna, NEW.idAktivitas, 'UPDATED', OLD.status, NEW.status,
   JSON_OBJECT(
     'before', JSON_OBJECT(
       'namaAktivitas', OLD.namaAktivitas, 'idKegiatan', OLD.idKegiatan,
       'waktuMulai', OLD.waktuMulai, 'waktuSelesai', OLD.waktuSelesai,
       'kategori', OLD.kategori, 'prioritas', OLD.prioritas,
       'lokasi', OLD.lokasi, 'status', OLD.status
     ),
     'after', JSON_OBJECT(
       'namaAktivitas', NEW.namaAktivitas, 'idKegiatan', NEW.idKegiatan,
       'waktuMulai', NEW.waktuMulai, 'waktuSelesai', NEW.waktuSelesai,
       'kategori', NEW.kategori, 'prioritas', NEW.prioritas,
       'lokasi', NEW.lokasi, 'status', NEW.status
     )
   ), UTC_TIMESTAMP(6));
