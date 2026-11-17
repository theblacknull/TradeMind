const express = require('express');
const router = express.Router();
const {
  chatController, chatStreamController, listModels, listMemory, deleteMemory,
} = require('../controllers/assistantController');

router.get('/models', listModels);
router.get('/memory/reports', listMemory);
router.delete('/memory/reports/:key', deleteMemory);
router.post('/chat', chatController);
router.post('/chat/stream', chatStreamController);

module.exports = router;
