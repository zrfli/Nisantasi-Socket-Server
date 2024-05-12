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
    headers["Access-Control-Allow-Origin"] = "http://misy.000.pe";
    headers["Access-Control-Allow-Headers"] = "origin, x-requested-with, content-type";
    headers["Access-Control-Allow-Methods"] = "PUT, GET, POST, DELETE, OPTIONS";
});

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
            console.log(colors.red(`[${getLocalTime()}] Hata: Yanlış kod veya öğrenci bulunamadı. (${studentId}) (${code})`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Yanlış kod veya öğrenci bulunamadı.' });
            return;
        }
    
        const teacherId = teacherCodes[code].teacherId;
    
        // Öğrencinin en son doğruladığı kodu kontrol et
        const latestCode = students[studentId].attendanceCode;
        if (latestCode && latestCode !== code) {
            console.log(colors.red(`[${getLocalTime()}] Hata: Öğrencinin eski bir kodla doğrulama girişimi (${studentId})`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Eski kodlarla doğrulama yapılamaz.' });
            return;
        }
    
        // Check if this student's attendance code was previously verified
        if (students[studentId].attendanceCode === code) {
            console.log(colors.yellow(`[${getLocalTime()}] Uyarı: ${students[studentId].name} (${studentId}) zaten bu kodu doğruladı.`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Bu kod zaten doğrulandı.' });
            return;
        }
    
        // Mark the student's attendance code as verified with the new code
        students[studentId].attendanceCode = code;
        teacherCodes[code] = { teacherId };
    
        // Notify the corresponding teacher about the student's attendance
        if (teachers[teacherId] && teachers[teacherId].socketId) {
            // Emit 'studentAttendance' event only to the teacher's socket
            io.to(teachers[teacherId].socketId).emit('studentAttendance', { studentId });
            console.log(colors.cyan(`[${getLocalTime()}] ${students[studentId].name} (${studentId}) öğretmene kodu doğruladı: ${teacherId}`));
    
            // Optionally, update the connected students list for the teacher
            updateConnectedStudentsList(teachers[teacherId].socketId);
    
            // Send verification result back to the student
            socket.emit('verifyAttendanceResult', { success: true, message: 'Yoklama kodu başarıyla doğrulandı.' });
    
            // Disconnect student's session after notifying the teacher
            disconnectStudentSession(studentId);
        } else {
            // If teacher not found or teacher's socket not available
            console.log(colors.red(`[${getLocalTime()}] Hata: Öğretmen bulunamadı veya bağlantı yok. (${teacherId})`));
            socket.emit('verifyAttendanceResult', { success: false, message: 'Öğretmen bulunamadı veya bağlantı yok.' });
        }
    });

    socket.on('disconnect', () => {
        const userId = findUserIdBySocketId(socket.id);
        if (userId) {
            handleUserDisconnect(socket, userId);

            if (teachers[userId]) {
                closeTeacherSession(userId); 
            } else if (students[userId]) {
                closeStudentSession(userId);
            }
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

    function disconnectStudentSession(studentId) {
        const student = students[studentId];
        if (student && student.socketId && io.sockets.sockets[student.socketId]) {
            io.sockets.sockets[student.socketId].disconnect(true);
            // Clean up student data
            delete students[studentId].attendanceCode;
            delete students[studentId];
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${studentId} öğrenci oturumu kapatıldı.`));
        } else {
            console.log(colors.red(`[${getLocalTime()}] Hata: Belirtilen öğrenci soketi bulunamadı veya zaten kapalı.`));
        }
    }
    
    function closeTeacherSession(teacherId) {
        if (teachers[teacherId]) {
            const teacherSocketId = teachers[teacherId].socketId;
    
            // Temizleme işlemleri
            delete teachers[teacherId];
            console.log(colors.yellow(`[${getLocalTime()}] Bilgi: ${teacherId} öğretmen oturumu kapatıldı.`));
    
            // Öğretmene ait yoklama kodlarını temizle
            const attendanceCodes = Object.keys(teacherCodes).filter(code => teacherCodes[code].teacherId === teacherId);
            attendanceCodes.forEach(code => delete teacherCodes[code]);
    
            // Öğretmenin öğrencilere gönderdiği bağlantıları temizle
            const connectedStudents = Object.values(students).filter(student => student.socketId && student.socketId !== teacherSocketId);
            if (connectedStudents.length > 0 && teacherSocketId) {
                io.to(teacherSocketId).emit('connectedStudentsList', { students: [] });
            }
    
            // Öğretmenin socket bağlantısını kapat
            if (teacherSocketId && io.sockets.sockets[teacherSocketId]) {
                io.sockets.sockets[teacherSocketId].disconnect(true);
            }
        } else {
            console.log(colors.red(`[${getLocalTime()}] Hata: ${teacherId} öğretmeni bulunamadı.`));
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
    console.log(colors.cyan(`[${getLocalTime()}] Bilgi: Sunucu dinleniyor - http://localhost:8080`));
});

function getLocalTime() {
    return DateTime.now().setZone('Europe/Istanbul').toLocaleString(DateTime.DATETIME_FULL);
}
