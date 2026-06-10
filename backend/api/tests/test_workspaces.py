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


from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient


class WorkspaceAPITest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin2", password="pass")
        self.user = User.objects.create_user("bob", password="pass")
        self.admin_token = Token.objects.create(user=self.admin)
        self.user_token = Token.objects.create(user=self.user)
        self.client = APIClient()

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_admin_creates_workspace(self):
        self._auth(self.admin_token)
        r = self.client.post("/api/workspaces/", {"name": "HR", "slug": "hr"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["name"], "HR")

    def test_user_cannot_create_workspace(self):
        self._auth(self.user_token)
        r = self.client.post("/api/workspaces/", {"name": "HR", "slug": "hr"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_list_own_workspaces(self):
        ws = Workspace.objects.create(name="Sales", slug="sales")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        self._auth(self.user_token)
        r = self.client.get("/api/workspaces/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["slug"], "sales")

    def test_admin_adds_member(self):
        ws = Workspace.objects.create(name="Ops", slug="ops")
        self._auth(self.admin_token)
        r = self.client.post(
            f"/api/workspaces/{ws.id}/members/",
            {"user_id": self.user.id},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertTrue(WorkspaceMembership.objects.filter(user=self.user, workspace=ws).exists())

    def test_admin_removes_member(self):
        ws = Workspace.objects.create(name="Ops", slug="ops")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        self._auth(self.admin_token)
        r = self.client.delete(f"/api/workspaces/{ws.id}/members/{self.user.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(WorkspaceMembership.objects.filter(user=self.user, workspace=ws).exists())
