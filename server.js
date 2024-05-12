const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const colors = require('colors');
const { DateTime } = require('luxon');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

const teacherHash = '3b0f26b84361585aa8dc65c2f35982e10226487048e2df6aebfc7212567e5d79';
const studentHash = '2';

const teachers = {};
const teacherCodes = {};

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

            // Öğrenci doğrulaması
            const verifiedStudentId = verifyStudent(studentId);
            if (!verifiedStudentId) {
                socket.emit('loginFail', { message: 'Geçersiz öğrenci ID veya parola.' });
                console.log(colors.red(`[${getLocalTime()}] Hata: Geçersiz öğrenci ID veya parola.`));
                return;
            }

            socket.emit('loginSuccess', { userId: studentId, role: 'student' });
            console.log(colors.green(`[${getLocalTime()}] Başarılı: ${studentFullName} (${studentId}) olarak öğrenci oturumu açıldı.`));
        } else {
            socket.emit('loginFail', { message: 'Geçersiz kullanıcı ID veya parola.' });
            console.log(colors.red(`[${getLocalTime()}] Hata: Geçersiz kullanıcı ID veya parola.`));
        }
    });

    socket.on('verifyAttendanceCode', ({ studentId, code }) => {
        if (!studentId || !code || !teacherCodes[code]) {
            console.log(colors.red(`[${getLocalTime()}] Hata: Yanlış kod veya yoklama kodu bulunamadı.`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Yanlış kod veya yoklama kodu bulunamadı.' });
            return;
        }

        const teacherId = teacherCodes[code].teacherId;

        // Doğrulama bilgisini temizle
        delete teacherCodes[code];

        // Yoklama bilgisini öğretmene gönder
        io.to(teachers[teacherId].socketId).emit('studentAttendance', { studentId });
        console.log(colors.cyan(`[${getLocalTime()}] ${studentId} öğrencisi yoklama kodunu doğruladı: ${code}`));

        // Doğrulama sonucunu öğrenciye gönder
        socket.emit('verifyAttendanceResult', { success: true, message: 'Yoklama kodu başarıyla doğrulandı.' });
    });

    socket.on('disconnect', () => {
        handleUserDisconnect(socket);
    });

    function generateAttendanceCodeForTeacher(teacherId) {
        const attendanceCode = generateAttendanceCode();
        teacherCodes[attendanceCode] = { teacherId };

        io.to(teachers[teacherId].socketId).emit('attendanceCodeGenerated', { code: attendanceCode });
        console.log(colors.magenta(`[${getLocalTime()}] Bilgi: Yoklama kodu oluşturuldu ve öğretmene gönderildi: ${attendanceCode}`));
    }

    function generateAttendanceCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    function getLocalTime() {
        return DateTime.now().setZone('Europe/Istanbul').toLocaleString(DateTime.DATETIME_FULL);
    }

    function verifyStudent(studentId) {
        // Burada öğrenci doğrulama işlemleri yapılır
        // Örneğin, öğrenci veritabanında var mı kontrol edilir
        // Geçerli bir öğrenci ID ise ID'yi döndürür, değilse null döndürür
        return studentId; // Örnekte sadece var olan bir ID'nin geçerli olduğunu varsayalım
    }

    function handleUserDisconnect(socket) {
        const user = findUserBySocketId(socket.id);
        if (!user) return;

        const { userId, role } = user;
        if (role === 'teacher') {
            delete teachers[userId];
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${userId} öğretmen çıkış yaptı.`));
        } else if (role === 'student') {
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${userId} öğrenci çıkış yaptı.`));
        }
    }

    function findUserBySocketId(socketId) {
        const teacher = Object.values(teachers).find(teacher => teacher.socketId === socketId);
        if (teacher) {
            return { userId: teacher.userId, role: 'teacher' };
        }
        // Öğrenci kontrolü burada yapılabilir, örnek olarak teachers nesnesini kullanabilirsiniz
        return null;
    }
});

server.listen(8080, () => {
    console.log(colors.cyan(`[${getLocalTime()}] Bilgi: Sunucu dinleniyor - http://localhost:8080`));
});
