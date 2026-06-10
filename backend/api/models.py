from django.contrib.auth.models import User
from django.db import models


class Conversation(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversations')
    title = models.CharField(max_length=200, default='New conversation')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'[{self.user.username}] {self.title}'


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=20)  # 'user' | 'assistant'
    content = models.TextField()
    citations = models.JSONField(default=list, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    judge_result = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']


class Workspace(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(
        User, through='WorkspaceMembership', related_name='workspaces'
    )

    def __str__(self):
        return self.name


class WorkspaceMembership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'workspace')]


class DocumentSummary(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='summaries')
    source = models.CharField(max_length=500)
    summary = models.TextField()
    file_size_bytes = models.BigIntegerField()
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('workspace', 'source')]

    def __str__(self):
        return f"{self.workspace.slug}/{self.source}"
