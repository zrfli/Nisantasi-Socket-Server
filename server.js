const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const colors = require('colors');
const { DateTime } = require('luxon');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

io.engine.on("headers", (headers, req) => {
    headers["Access-Control-Allow-Origin"] = "http://misy.000.pe";
    headers["Access-Control-Allow-Headers"] = "origin, x-requested-with, content-type";
    headers["Access-Control-Allow-Methods"] = "PUT, GET, POST, DELETE, OPTIONS";
});


app.use(express.static('public'));

const teacherHash = '3b0f26b84361585aa8dc65c2f35982e10226487048e2df6aebfc7212567e5d79';
const studentHash = '2';

const teachers = {};
const activeVerification = {}; // Aktif doğrulama bilgileri

io.on('connection', (socket) => {
    console.log(colors.yellow(`[${getLocalTime()}] Yeni bir kullanıcı bağlandı`));

    socket.on('login', ({ userId, userName, passwordHash }) => {
        if (!userId || !passwordHash) {
            socket.emit('loginFail', { message: 'Kullanıcı ID veya parola boş olamaz.' });
            console.log(colors.red(`[${getLocalTime()}] Hata: Kullanıcı ID veya parola boş.`));
            return;
        }

        if (passwordHash === teacherHash) {
            const teacherId = userId;

            if (teachers[teacherId]) {
                socket.emit('loginFail', { message: 'Bu öğretmen zaten oturum açmış.' });
                console.log(colors.red(`[${getLocalTime()}] Hata: ${teacherId} zaten oturum açmış.`));
                return;
            }

            teachers[teacherId] = { name: 'Öğretmen', socketId: socket.id };
            socket.emit('loginSuccess', { userId: teacherId, role: 'teacher' });
            console.log(colors.green(`[${getLocalTime()}] Başarılı: ${teacherId} olarak öğretmen oturumu açıldı.`));

            generateAttendanceCodeForTeacher(teacherId);
        } else if (passwordHash === studentHash) {
            const studentId = userId;
            const studentFullName = userName;

            socket.emit('loginSuccess', { userId: studentId, role: 'student' });
            console.log(colors.green(`[${getLocalTime()}] Başarılı: ${studentFullName} (${studentId}) olarak öğrenci oturumu açıldı.`));

            socket.on('verifyAttendanceCode', ({ code }) => {
                if (!code || !activeVerification[code]) {
                    console.log(colors.red(`[${getLocalTime()}] Hata: Yanlış kod veya doğrulama bulunamadı.`));
                    socket.emit('verifyAttendanceResult', { success: false, message: 'Yanlış kod veya doğrulama bulunamadı.' });
                    return;
                }

                const { studentId: verifiedStudentId, teacherId } = activeVerification[code];

                if (verifiedStudentId === studentId) {
                    io.to(teachers[teacherId].socketId).emit('studentAttendance', { studentId });
                    console.log(colors.cyan(`[${getLocalTime()}] ${studentFullName} (${studentId}) öğretmene kodu doğruladı: ${teacherId}`));

                    // Doğrulama bilgisini temizle
                    delete activeVerification[code];

                    // Doğrulama sonucunu öğrenciye gönder
                    socket.emit('verifyAttendanceResult', { success: true, message: 'Yoklama kodu başarıyla doğrulandı.' });
                } else {
                    console.log(colors.red(`[${getLocalTime()}] Hata: Yetkisiz erişim.`));
                    socket.emit('verifyAttendanceResult', { success: false, message: 'Yetkisiz erişim.' });
                }
            });
        } else {
            socket.emit('loginFail', { message: 'Geçersiz kullanıcı ID veya parola.' });
            console.log(colors.red(`[${getLocalTime()}] Hata: Geçersiz kullanıcı ID veya parola.`));
        }
    });

    socket.on('disconnect', () => {
        const userId = findUserIdBySocketId(socket.id);
        if (userId) {
            handleUserDisconnect(socket, userId);
        }
    });

    function generateAttendanceCodeForTeacher(teacherId) {
        const attendanceCode = generateAttendanceCode();
        activeVerification[attendanceCode] = { teacherId };

        if (teachers[teacherId] && teachers[teacherId].socketId) {
            io.to(teachers[teacherId].socketId).emit('attendanceCodeGenerated', { code: attendanceCode });
            console.log(colors.magenta(`[${getLocalTime()}] Bilgi: Yoklama kodu oluşturuldu ve öğretmene gönderildi: ${attendanceCode}`));
        }
    }

    function generateAttendanceCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    function findUserIdBySocketId(socketId) {
        const teacherId = Object.keys(teachers).find(key => teachers[key].socketId === socketId);
        if (teacherId) return teacherId;

        const verificationCode = Object.keys(activeVerification).find(key => activeVerification[key].teacherId === socketId);
        if (verificationCode) return activeVerification[verificationCode].studentId;

        return null;
    }

    function handleUserDisconnect(socket, userId) {
        if (teachers[userId]) {
            const teacherId = userId;
            delete teachers[teacherId];
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${teacherId} öğretmen çıkış yaptı.`));
        } else if (students[userId]) {
            const studentId = userId;
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${studentId} öğrenci çıkış yaptı.`));
        }
    }
});

const clearConsole = () => {
    console.clear();
    console.log(colors.yellow(`[${getLocalTime()}] Konsol temizlendi - Son temizleme`));
};

setInterval(clearConsole, 60000);

server.listen(8080, () => {
    console.log(colors.cyan(`[${getLocalTime()}] Bilgi: Sunucu dinleniyor - http://localhost:8080`));
});

function getLocalTime() {
    return DateTime.now().setZone('Europe/Istanbul').toLocaleString(DateTime.DATETIME_FULL);
}
