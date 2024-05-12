socket.on('verifyAttendanceCode', ({ studentId, code }) => {
    if (!studentId || !code || !teacherCodes[code] || !students[studentId]) {
        console.log(colors.red(`[${getLocalTime()}] Hata: Yanlış kod veya öğrenci bulunamadı. (${studentId}) (${code})`));
        socket.emit('verifyAttendanceResult', { success: false, message: 'Yanlış kod veya öğrenci bulunamadı.' });
        return;
    }

    const teacherId = teacherCodes[code].teacherId;

    if (students[studentId].attendanceCode === code) {
        console.log(colors.yellow(`[${getLocalTime()}] Uyarı: ${students[studentId].name} (${studentId}) zaten bu kodu doğruladı.`));
        socket.emit('verifyAttendanceResult', { success: false, message: 'Bu kod zaten doğrulandı.' });
        return;
    }

    // Doğrulama kodunu öğrenciye atanması
    students[studentId].attendanceCode = code;

    // Doğrulanmış kodu sadece ilgili öğretmene bildirme
    if (teachers[teacherId] && teachers[teacherId].socketId) {
        io.to(teachers[teacherId].socketId).emit('studentAttendance', { studentId });
        console.log(colors.cyan(`[${getLocalTime()}] ${students[studentId].name} (${studentId}) öğretmen kodunu girdi: ${teacherId}`));

        // Öğrencinin durumunu diğer öğretmenlere göndermeyi kaldırma
        // updateConnectedStudentsList(teachers[teacherId].socketId);

        socket.emit('verifyAttendanceResult', { success: true, message: 'Yoklama kodu başarıyla doğrulandı.' });
    }
});