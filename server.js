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
const students = {};
const teacherCodes = {};

io.engine.on("headers", (headers, req) => {
    headers["Access-Control-Allow-Origin"] = "http://misy.000.pe"
    headers["Access-Control-Allow-Headers"] = "origin, x-requested-with, content-type"
    headers["Access-Control-Allow-Methodsn"] = "PUT, GET, POST, DELETE, OPTIONS"
})

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

            if (students[studentId]) {
                socket.emit('loginFail', { message: 'Bu öğrenci ID ile zaten oturum açılmış.' });
                console.log(colors.red(`[${getLocalTime()}] Hata: ${studentId} ile zaten oturum açılmış.`));
                return;
            }

            students[studentId] = { name: studentFullName, studentId: studentId, socketId: socket.id };
            socket.emit('loginSuccess', { userId: studentId, role: 'student' });
            console.log(colors.green(`[${getLocalTime()}] Başarılı: ${studentFullName} (${studentId}) olarak öğrenci oturumu açıldı.`));
        } else {
            socket.emit('loginFail', { message: 'Geçersiz kullanıcı ID veya parola.' });
            console.log(colors.red(`[${getLocalTime()}] Hata: Geçersiz kullanıcı ID veya parola.`));
        }
    });

    socket.on('verifyAttendanceCode', ({ studentId, code }) => {
        if (!studentId || !code || !teacherCodes[code] || !students[studentId]) {
            console.log(colors.red(`[${getLocalTime()}] Hata: Yanlış kod veya öğrenci bulunamadı.`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Yanlış kod veya öğrenci bulunamadı.' });
            return;
        }
    
        const teacherId = teacherCodes[code].teacherId;
    
        if (students[studentId].attendanceCode === code) {
            console.log(colors.yellow(`[${getLocalTime()}] Uyarı: ${students[studentId].name} (${studentId}) zaten bu kodu doğruladı.`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Bu kod zaten doğrulandı.' });
            return;
        }
    
        students[studentId].attendanceCode = code;
    
        if (teachers[teacherId] && teachers[teacherId].socketId) {
            io.to(teachers[teacherId].socketId).emit('studentAttendance', { studentId });
            console.log(colors.cyan(`[${getLocalTime()}] ${students[studentId].name} (${studentId}) öğretmen kodunu girdi: ${teacherId}`));
    
            updateConnectedStudentsList(teachers[teacherId].socketId);
    
            socket.emit('verifyAttendanceResult', { success: true, message: 'Yoklama kodu başarıyla doğrulandı.' });
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
        teacherCodes[attendanceCode] = { teacherId };

        if (teachers[teacherId] && teachers[teacherId].socketId) {
            io.to(teachers[teacherId].socketId).emit('attendanceCodeGenerated', { code: attendanceCode });
            console.log(colors.magenta(`[${getLocalTime()}] Bilgi: Yoklama kodu oluşturuldu ve öğretmene gönderildi: ${attendanceCode}`));

            setInterval(() => {
                const newAttendanceCode = generateAttendanceCode();
                teacherCodes[newAttendanceCode] = { teacherId };
                if (teachers[teacherId] && teachers[teacherId].socketId) {
                    io.to(teachers[teacherId].socketId).emit('attendanceCodeGenerated', { code: newAttendanceCode });
                    console.log(colors.magenta(`[${getLocalTime()}] Bilgi: Yoklama kodu güncellendi ve öğretmene gönderildi: ${newAttendanceCode}`));
                }
            }, 40000);
        }
    }

    function updateConnectedStudentsList(socketId) {
        const connectedStudents = Object.values(students).filter(student => student.socketId && student.socketId !== socketId);
        io.to(socketId).emit('connectedStudentsList', { students: connectedStudents });
    }

    function generateAttendanceCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    function findUserIdBySocketId(socketId) {
        const userId = Object.keys(teachers).find(key => teachers[key].socketId === socketId);
        if (userId) return userId;
        return Object.keys(students).find(key => students[key].socketId === socketId);
    }

    function handleUserDisconnect(socket, userId) {
        if (teachers[userId]) {
            const teacherId = userId;
            delete teachers[teacherId];
            if (teacherCodes[socket.id]) {
                delete teacherCodes[socket.id];
            }
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${teacherId} öğretmen çıkış yaptı.`));
            updateConnectedStudentsList(socket.id);
        } else if (students[userId]) {
            const studentId = userId;
            delete students[studentId].attendanceCode;
            delete students[studentId];
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
    console.log(colors.cyan(`[${getLocalTime()}] Bilgi: Sunucu dinleniyor - http://localhost:3000`));
});

function getLocalTime() {
    return DateTime.now().setZone('Europe/Istanbul').toLocaleString(DateTime.DATETIME_FULL);
}