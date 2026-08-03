// Horarios semilla del colegio, transcritos desde las imágenes oficiales.
// Vivían hardcodeados en el bundle del frontend (con los emails de los alumnos
// a la vista); acá se aplican vía POST /schedules/template.

const SCHEDULE_TEMPLATES = {
  'anais_rehbein.ojeda@cicpm.cl': [
    // Lunes (0)
    { day_of_week: 0, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 0, period_order: 2, subject: 'Matemática',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 0, period_order: 3, subject: 'Historia',         start_time: '09:35', end_time: '10:20' },
    { day_of_week: 0, period_order: 4, subject: 'Taller Lenguaje',  start_time: '10:20', end_time: '11:05' },
    { day_of_week: 0, period_order: 5, subject: 'Religión',         start_time: '11:15', end_time: '12:00' },
    { day_of_week: 0, period_order: 6, subject: 'Religión',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 0, period_order: 7, subject: 'Música',           start_time: '13:40', end_time: '14:25' },
    { day_of_week: 0, period_order: 8, subject: 'Música',           start_time: '14:25', end_time: '15:10' },
    // Martes (1) - Horario diferido
    { day_of_week: 1, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 1, period_order: 2, subject: 'Matemática',       start_time: '08:30', end_time: '09:10' },
    { day_of_week: 1, period_order: 3, subject: 'Ed. Física',       start_time: '09:30', end_time: '10:10' },
    { day_of_week: 1, period_order: 4, subject: 'Ed. Física',       start_time: '10:10', end_time: '10:50' },
    { day_of_week: 1, period_order: 5, subject: 'Artes',            start_time: '11:00', end_time: '11:40' },
    { day_of_week: 1, period_order: 6, subject: 'Artes',            start_time: '11:40', end_time: '12:20' },
    { day_of_week: 1, period_order: 7, subject: 'Lenguaje',         start_time: '13:10', end_time: '13:50' },
    { day_of_week: 1, period_order: 8, subject: 'Lenguaje',         start_time: '13:50', end_time: '14:30' },
    // Miércoles (2)
    { day_of_week: 2, period_order: 1, subject: 'Ciencias',         start_time: '07:45', end_time: '08:30' },
    { day_of_week: 2, period_order: 2, subject: 'Taller Mat.',      start_time: '08:30', end_time: '09:15' },
    { day_of_week: 2, period_order: 3, subject: 'Lenguaje',         start_time: '09:35', end_time: '10:20' },
    { day_of_week: 2, period_order: 4, subject: 'Lenguaje',         start_time: '10:20', end_time: '11:05' },
    { day_of_week: 2, period_order: 5, subject: 'Taller Lenguaje',  start_time: '11:15', end_time: '12:00' },
    { day_of_week: 2, period_order: 6, subject: 'Ory/Cc',           start_time: '12:00', end_time: '12:45' },
    { day_of_week: 2, period_order: 7, subject: 'Matemática',       start_time: '13:40', end_time: '14:25' },
    { day_of_week: 2, period_order: 8, subject: 'Matemática',       start_time: '14:25', end_time: '15:10' },
    // Jueves (3)
    { day_of_week: 3, period_order: 1, subject: 'Ed. Física',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 3, period_order: 2, subject: 'Ed. Física',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 3, period_order: 3, subject: 'Taller Mat.',      start_time: '09:35', end_time: '10:20' },
    { day_of_week: 3, period_order: 4, subject: 'Tecnología',       start_time: '10:20', end_time: '11:05' },
    { day_of_week: 3, period_order: 5, subject: 'Lenguaje',         start_time: '11:15', end_time: '12:00' },
    { day_of_week: 3, period_order: 6, subject: 'Lenguaje',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 3, period_order: 7, subject: 'Inglés',           start_time: '13:40', end_time: '14:25' },
    { day_of_week: 3, period_order: 8, subject: 'Inglés',           start_time: '14:25', end_time: '15:10' },
    // Viernes (4)
    { day_of_week: 4, period_order: 1, subject: 'Inglés',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 4, period_order: 2, subject: 'Inglés',           start_time: '08:30', end_time: '09:15' },
    { day_of_week: 4, period_order: 3, subject: 'Historia',         start_time: '09:35', end_time: '10:20' },
    { day_of_week: 4, period_order: 4, subject: 'Historia',         start_time: '10:20', end_time: '11:05' },
    { day_of_week: 4, period_order: 5, subject: 'Ciencias',         start_time: '11:15', end_time: '12:00' },
    { day_of_week: 4, period_order: 6, subject: 'Ciencias',         start_time: '12:00', end_time: '12:45' },
  ],
  'gabriel_parra.ojeda@cicpm.cl': [
    // Lunes (0)
    { day_of_week: 0, period_order: 1, subject: 'Inglés',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 0, period_order: 2, subject: 'Lenguaje',         start_time: '08:30', end_time: '09:15' },
    { day_of_week: 0, period_order: 3, subject: 'Lenguaje',         start_time: '09:15', end_time: '10:00' },
    { day_of_week: 0, period_order: 4, subject: 'Biología',         start_time: '10:20', end_time: '11:05' },
    { day_of_week: 0, period_order: 5, subject: 'Biología',         start_time: '11:05', end_time: '11:50' },
    { day_of_week: 0, period_order: 6, subject: 'PAES Mat.',        start_time: '12:00', end_time: '12:45' },
    { day_of_week: 0, period_order: 7, subject: 'PAES Mat.',        start_time: '12:45', end_time: '13:30' },
    { day_of_week: 0, period_order: 8, subject: 'PAES Lenguaje',    start_time: '13:30', end_time: '14:15' },
    { day_of_week: 0, period_order: 9, subject: 'Matemática',       start_time: '15:15', end_time: '16:00' },
    // Martes (1) - Horario diferido
    { day_of_week: 1, period_order: 1, subject: 'Ory/Cc',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 1, period_order: 2, subject: 'Historia',         start_time: '08:30', end_time: '09:10' },
    { day_of_week: 1, period_order: 3, subject: 'Historia',         start_time: '09:10', end_time: '09:50' },
    { day_of_week: 1, period_order: 4, subject: 'Física',           start_time: '10:10', end_time: '10:50' },
    { day_of_week: 1, period_order: 5, subject: 'Física',           start_time: '10:50', end_time: '11:30' },
    { day_of_week: 1, period_order: 6, subject: 'Lenguaje',         start_time: '11:40', end_time: '12:20' },
    { day_of_week: 1, period_order: 7, subject: 'Matemática',       start_time: '12:20', end_time: '13:00' },
    { day_of_week: 1, period_order: 8, subject: 'Matemática',       start_time: '13:00', end_time: '13:40' },
    { day_of_week: 1, period_order: 9, subject: 'Química',          start_time: '14:30', end_time: '15:10' },
    // Miércoles (2)
    { day_of_week: 2, period_order: 1, subject: 'Física',           start_time: '07:45', end_time: '08:30' },
    { day_of_week: 2, period_order: 2, subject: 'Lenguaje',         start_time: '08:30', end_time: '09:15' },
    { day_of_week: 2, period_order: 3, subject: 'Lenguaje',         start_time: '09:15', end_time: '10:00' },
    { day_of_week: 2, period_order: 4, subject: 'Ed. Física',       start_time: '10:20', end_time: '11:05' },
    { day_of_week: 2, period_order: 5, subject: 'Ed. Física',       start_time: '11:05', end_time: '11:50' },
    { day_of_week: 2, period_order: 6, subject: 'Historia',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 2, period_order: 7, subject: 'Historia',         start_time: '12:45', end_time: '13:30' },
    { day_of_week: 2, period_order: 8, subject: 'Inglés',           start_time: '13:30', end_time: '14:15' },
    { day_of_week: 2, period_order: 9, subject: 'Religión',         start_time: '15:15', end_time: '16:00' },
    // Jueves (3)
    { day_of_week: 3, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 3, period_order: 2, subject: 'Tecnología',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 3, period_order: 3, subject: 'Tecnología',       start_time: '09:15', end_time: '10:00' },
    { day_of_week: 3, period_order: 4, subject: 'Inglés',           start_time: '10:20', end_time: '11:05' },
    { day_of_week: 3, period_order: 5, subject: 'Inglés',           start_time: '11:05', end_time: '11:50' },
    { day_of_week: 3, period_order: 6, subject: 'Artes/Música',     start_time: '12:00', end_time: '12:45' },
    { day_of_week: 3, period_order: 7, subject: 'Artes/Música',     start_time: '12:45', end_time: '13:30' },
    { day_of_week: 3, period_order: 8, subject: 'Ory/Cc',           start_time: '13:30', end_time: '14:15' },
    { day_of_week: 3, period_order: 9, subject: 'Biología',         start_time: '15:15', end_time: '16:00' },
    // Viernes (4)
    { day_of_week: 4, period_order: 1, subject: 'Matemática',       start_time: '07:45', end_time: '08:30' },
    { day_of_week: 4, period_order: 2, subject: 'Matemática',       start_time: '08:30', end_time: '09:15' },
    { day_of_week: 4, period_order: 3, subject: 'Religión',         start_time: '09:15', end_time: '10:00' },
    { day_of_week: 4, period_order: 4, subject: 'Química',          start_time: '10:20', end_time: '11:05' },
    { day_of_week: 4, period_order: 5, subject: 'Química',          start_time: '11:05', end_time: '11:50' },
    { day_of_week: 4, period_order: 6, subject: 'Lenguaje',         start_time: '12:00', end_time: '12:45' },
    { day_of_week: 4, period_order: 7, subject: 'Lenguaje',         start_time: '12:45', end_time: '13:30' },
  ],
};

// Hijos semilla: se usan solo para poblar la UI antes de que exista la primera
// fila en `children` (la tabla se llena al primer intento de conexión).
const SEED_CHILDREN = [
  { email: 'anais_rehbein.ojeda@cicpm.cl', name: 'Anais' },
  { email: 'gabriel_parra.ojeda@cicpm.cl', name: 'Gabriel' },
];

module.exports = { SCHEDULE_TEMPLATES, SEED_CHILDREN };
