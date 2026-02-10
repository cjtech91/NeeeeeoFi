const { db } = require('../database/db');

class ChatService {
    saveMessage(senderMac, message, isFromAdmin, chatType = 'hotspot') {
        const stmt = db.prepare('INSERT INTO chat_messages (sender_mac, message, is_from_admin, timestamp, chat_type) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)');
        return stmt.run(senderMac, message, isFromAdmin ? 1 : 0, chatType);
    }

    getMessages(senderMac, limit = 50, type = null) {
        // If senderMac is provided, get messages for that specific user (conversation)
        // If not provided (and logic handles it), it might be global, but for this app, chat is per-device.
        let query = 'SELECT * FROM chat_messages WHERE sender_mac = ?';
        
        if (type) {
            query += ` AND chat_type = '${type}'`;
        }

        query += ' ORDER BY timestamp ASC LIMIT ?';
        const stmt = db.prepare(query);
        return stmt.all(senderMac, limit);
    }

    // For Admin: Get list of all users who have chatted, with their last message
    getAllConversations(type = null) {
        // Sanitize type to prevent SQL injection
        if (type && !['hotspot', 'pppoe'].includes(type)) {
            type = null;
        }

        // Group by sender_mac to get unique conversations
        // We need to fetch the last message for each mac
        // Join with users table to get client_id
        let subQueryWhere = '1=1';
        if (type) {
            subQueryWhere += ` AND chat_type = '${type}'`;
        }

        let query = `
            SELECT 
                m.sender_mac, 
                u.client_id,
                u.user_code,
                m.message, 
                m.timestamp,
                m.chat_type,
                (SELECT COUNT(*) FROM chat_messages WHERE sender_mac = m.sender_mac AND is_read = 0 AND is_from_admin = 0) as unread_count
            FROM chat_messages m
            LEFT JOIN users u ON (u.mac_address = m.sender_mac OR u.client_id = m.sender_mac) AND m.chat_type = 'hotspot'
            WHERE m.id IN (
                SELECT MAX(id) 
                FROM chat_messages 
                WHERE ${subQueryWhere}
                GROUP BY sender_mac
            )
        `;
        
        if (type) {
            query += ` AND m.chat_type = '${type}'`;
        }

        query += ` ORDER BY m.timestamp DESC`;

        const stmt = db.prepare(query);
        return stmt.all();
    }

    markAsRead(senderMac) {
        const stmt = db.prepare('UPDATE chat_messages SET is_read = 1 WHERE sender_mac = ? AND is_from_admin = 0');
        return stmt.run(senderMac);
    }
}

module.exports = new ChatService();
