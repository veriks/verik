export const findUser = (id: string) => db.query(`SELECT * FROM users WHERE id = ${id}`);
