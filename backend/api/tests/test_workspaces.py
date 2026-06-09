from django.contrib.auth.models import User
from django.test import TestCase

from api.models import Workspace, WorkspaceMembership


class WorkspaceModelTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin", password="pass")
        self.user = User.objects.create_user("alice", password="pass")

    def test_create_workspace(self):
        ws = Workspace.objects.create(name="Finance", slug="finance")
        self.assertEqual(str(ws), "Finance")

    def test_membership(self):
        ws = Workspace.objects.create(name="Finance", slug="finance")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        self.assertIn(ws, self.user.workspaces.all())

    def test_duplicate_membership_raises(self):
        from django.db import IntegrityError
        ws = Workspace.objects.create(name="Finance", slug="finance")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        with self.assertRaises(IntegrityError):
            WorkspaceMembership.objects.create(user=self.user, workspace=ws)
